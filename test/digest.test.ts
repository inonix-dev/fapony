import { test } from "bun:test";
// test/digest.test.ts — tests for src/digest/
//
// Pin env vars to isolate from real machine data (SPEC §7):
// - FAPONY_STATE_DIR → temp dir (no real db)
// - FAPONY_OPENCODE_DB / FAPONY_ZCODE_DB → nonexistent
// - FAPONY_CLAUDE_PROJECTS_DIR / FAPONY_CODEX_SESSIONS_DIR → nonexistent

import assert from "node:assert";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { addEvent, newRun, openDb } from "../src/db/store.js";
import { collectDigest } from "../src/digest/collect.js";
import { renderDigestHtml } from "../src/digest/html.js";
import { renderDigestText } from "../src/digest/text.js";
import { recordHintFire } from "../src/hook.js";
import { type FaelFixtureRow, withFakeFael } from "./helpers.js";

// --- env isolation ---

// What the fake `fael` prints for the current test (set by withIsolatedEnv).
let publish: (rows: (FaelFixtureRow | string)[]) => void = () => {};

function withIsolatedEnv(fn: () => void | Promise<void>): void | Promise<void> {
  const stateDir = mkdtempSync(join(tmpdir(), "fapony-digest-"));
  const prev: Record<string, string | undefined> = {};
  const keys = [
    "FAPONY_STATE_DIR",
    "FAPONY_OPENCODE_DB",
    "FAPONY_ZCODE_DB",
    "FAPONY_CLAUDE_PROJECTS_DIR",
    "FAPONY_CODEX_SESSIONS_DIR",
    "FAPONY_CONFIG",
  ];
  for (const k of keys) {
    prev[k] = process.env[k];
  }
  process.env.FAPONY_STATE_DIR = stateDir;
  process.env.FAPONY_OPENCODE_DB = "/nonexistent/opencode.db";
  process.env.FAPONY_ZCODE_DB = "/nonexistent/zcode.db";
  process.env.FAPONY_CLAUDE_PROJECTS_DIR = "/nonexistent/claude";
  process.env.FAPONY_CODEX_SESSIONS_DIR = "/nonexistent/codex";
  process.env.FAPONY_CONFIG = "/nonexistent/fapony.config.json";
  try {
    return withFakeFael((setRows) => {
      publish = setRows;
      return fn();
    });
  } finally {
    for (const k of keys) {
      if (prev[k] === undefined) delete process.env[k];
      else process.env[k] = prev[k];
    }
    rmSync(stateDir, { recursive: true, force: true });
  }
}

// --- helpers ---

function makeWorktree(): string {
  const dir = mkdtempSync(join(tmpdir(), "fapony-wt-"));
  mkdirSync(join(dir, ".fapony", "plan"), { recursive: true });
  mkdirSync(join(dir, ".fapony", "done"), { recursive: true });
  // fake git repo
  mkdirSync(join(dir, ".git"), { recursive: true });
  writeFileSync(join(dir, ".git", "config"), "");
  return dir;
}

/** Old-shape mem rows → what `fael find --json` prints (bug → issue, a
 *  close row folds into its target's `closed`). */
function writeMemLog(_dir: string, rows: Record<string, unknown>[]): void {
  const out: FaelFixtureRow[] = [];
  for (const r of rows) {
    if (r.kind === "close") continue;
    out.push({
      id: String(r.id),
      ts: String(r.ts),
      by: String(r.agent),
      kind: r.kind === "bug" ? "issue" : String(r.kind),
      text: String(r.text),
    });
  }
  for (const r of rows) {
    if (r.kind !== "close") continue;
    const target = out.find((o) => o.id === r.ref);
    if (target)
      target.closed = {
        id: `c-${String(r.ref)}`,
        ts: String(r.ts),
        by: String(r.agent),
        text: String(r.text),
      };
  }
  publish(out);
}

function writePlanFile(dir: string, name: string, content: string): void {
  writeFileSync(join(dir, ".fapony", "plan", name), content);
}

// --- tests ---

test("testDigestEmptyRepo", async () => {
  await withIsolatedEnv(async () => {
    const dir = mkdtempSync(join(tmpdir(), "fapony-empty-"));
    try {
      const data = await collectDigest({ worktree: dir });
      assert.ok(data.sources.length >= 5, "should have at least 5 sources");
      for (const s of data.sources) {
        // fael answering with 0 rows is a source that works, not a missing one
        if (s.name === "memory") continue;
        assert.equal(s.ok, false, `${s.name} should be ok:false`);
      }
      assert.equal(data.decisions.length, 0);
      assert.equal(data.bugs.open.length, 0);
      assert.equal(data.bugs.closed.length, 0);
      assert.equal(data.notes.length, 0);
      assert.equal(data.plans.pending.length, 0);
      assert.equal(data.plans.shipped.length, 0);
      assert.equal(data.skipped_malformed, 0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
  console.log("  ✓ empty repo — every non-memory source ok:false");
});

test("testDigestSinceFilter", async () => {
  await withIsolatedEnv(async () => {
    const dir = makeWorktree();
    try {
      const now = Date.now();
      const rows = [
        {
          ts: new Date(now - 12 * 3600000).toISOString(), // 12 hours ago
          agent: "a",
          kind: "decision",
          text: "recent",
          id: "r1",
        },
        {
          ts: new Date(now - 60 * 86400000).toISOString(), // 60 days ago
          agent: "b",
          kind: "decision",
          text: "old",
          id: "r2",
        },
      ];
      writeMemLog(dir, rows);

      const d1 = await collectDigest({ worktree: dir, since: "1d", _now: now });
      const d60 = await collectDigest({
        worktree: dir,
        since: "60d",
        _now: now,
      });

      assert.equal(d1.decisions.length, 1, "1d should have 1 decision");
      assert.equal(d60.decisions.length, 2, "60d should have 2 decisions");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
  console.log(
    "  ✓ since filter — different ranges return different row counts",
  );
});

test("testDigestEscInjection", async () => {
  await withIsolatedEnv(async () => {
    const dir = makeWorktree();
    try {
      writeMemLog(dir, [
        {
          ts: new Date().toISOString(),
          agent: "attacker",
          kind: "decision",
          text: "<script>alert('xss')</script>",
          id: "x1",
        },
      ]);

      const data = await collectDigest({ worktree: dir });
      const html = renderDigestHtml(data);

      assert.ok(
        !html.includes("<script>"),
        "HTML should not contain raw <script> tag",
      );
      assert.ok(
        html.includes("&lt;script&gt;"),
        "HTML should escape <script> to entities",
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
  console.log(
    "  ✓ esc injection — <script> in mem note does not leak into HTML",
  );
});

test("testDigestMalformedLine", async () => {
  await withIsolatedEnv(async () => {
    const dir = makeWorktree();
    try {
      publish([
        "bad json {{{",
        {
          id: "g1",
          ts: new Date().toISOString(),
          kind: "note",
          text: "good row",
        },
      ]);

      const data = await collectDigest({ worktree: dir });
      assert.equal(data.skipped_malformed, 1, "should skip 1 malformed line");
      assert.equal(data.notes.length, 1, "should still read the good row");
      assert.equal(data.notes[0].text, "good row");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
  console.log("  ✓ malformed line — skipped count, other rows still read");
});

test("testDigestJsonSubsetOfText", async () => {
  await withIsolatedEnv(async () => {
    const dir = makeWorktree();
    try {
      const now = Date.now();
      writeMemLog(dir, [
        {
          ts: new Date(now - 3600000).toISOString(),
          agent: "t",
          kind: "decision",
          text: "chose X over Y",
          id: "d1",
        },
        {
          ts: new Date(now - 3500000).toISOString(),
          agent: "t",
          kind: "note",
          text: "next session must know Z",
          id: "n1",
        },
        {
          ts: new Date(now - 3400000).toISOString(),
          agent: "t",
          kind: "bug",
          text: "thing is broken",
          id: "b1",
        },
      ]);
      writeFileSync(join(dir, ".fapony", "done", "PLAN-old.md"), "# old\n");
      // one run, fail round 0 then pass-good round 1: 1 unit, 0% round-1
      const db = openDb();
      const runId = newRun(db, dir, null, null, "abc");
      addEvent(db, runId, "gate", {
        verdict: "fail",
        note: "[spec_gap] wrong shape",
        round: 0,
      });
      addEvent(db, runId, "gate", {
        verdict: "pass-good",
        note: "[none] fixed",
        round: 1,
      });
      db.close();

      const data = await collectDigest({ worktree: dir, _now: now });
      const text = renderDigestText(data);
      const html = renderDigestHtml(data);

      // header + scope
      assert.ok(text.includes("fapony digest"), "header");
      assert.ok(text.includes(data.worktree), "worktree path");
      assert.ok(text.includes(data.scope_note), "scope_note");
      // headline is run-based, not gate-based
      assert.equal(data.verdicts.units_graded, 1, "1 run = 1 unit");
      assert.equal(data.verdicts.round1_pct, 0, "first gate failed");
      assert.ok(
        text.includes("1 unit graded · 0% passed round 1"),
        "headline counts runs",
      );
      // every mem row kind has a section
      assert.ok(text.includes("chose X over Y"), "decision text");
      assert.ok(text.includes("NOTES (1)"), "NOTES section");
      assert.ok(text.includes("next session must know Z"), "note text");
      assert.ok(text.includes("thing is broken"), "bug text");
      assert.ok(text.includes("1 shipped"), "shipped count");
      // every verdict tally has a place
      assert.ok(text.includes("BY GRADE"), "BY GRADE section");
      assert.ok(text.includes("pass-good"), "grade row");
      assert.ok(text.includes("spec_gap"), "reason_code row");
      // sources table names every source
      for (const s of data.sources)
        assert.ok(text.includes(s.name), `source ${s.name}`);
      // html parity for the same fields
      assert.ok(html.includes("Notes (1)"), "html NOTES section");
      assert.ok(html.includes("next session must know Z"), "html note text");
      assert.ok(html.includes("By Grade"), "html BY GRADE section");
      assert.ok(
        html.includes("1 unit graded ·") || html.includes("1</strong> unit"),
        "html headline counts runs",
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
  console.log("  ✓ json ⊆ text — every payload field appears in text+html");
});

test("testDigestInvalidSince", async () => {
  await withIsolatedEnv(async () => {
    let threw = false;
    try {
      await collectDigest({ since: "invalid-format" });
    } catch {
      threw = true;
    }
    assert.ok(threw, "should throw on invalid --since format");
  });
  console.log("  ✓ invalid --since — throws error");
});

test("testDigestPlanProgress", async () => {
  await withIsolatedEnv(async () => {
    const dir = makeWorktree();
    try {
      writePlanFile(
        dir,
        "PLAN-test.md",
        `---
kind: unit
status: active
---

## TL;DR
- [x] step 1 done
- [ ] step 2 pending
- [ ] step 3 pending
`,
      );

      const data = await collectDigest({ worktree: dir });
      const plan = data.plans.pending.find((p) => p.file === "PLAN-test.md");
      assert.ok(plan, "plan should exist");
      assert.equal(plan!.done, 1);
      assert.equal(plan!.total, 3);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
  console.log("  ✓ plan with progress — checkbox counting works");
});

test("testDigestImpactSection", async () => {
  await withIsolatedEnv(async () => {
    const dir = makeWorktree();
    try {
      const ts = new Date().toISOString();
      recordHintFire({
        ts,
        worktree: dir,
        surface: "read",
        file: "src/big.ts",
        count: 1,
      });
      recordHintFire({
        ts,
        worktree: dir,
        surface: "mem",
        file: "src/big.ts",
        count: 2,
      });

      const data = await collectDigest({ worktree: dir });
      assert.ok(data.impact, "impact present when a log exists");
      assert.equal(data.impact!.fired, 2, "counts both rows");
      assert.equal(data.impact!.by_surface.read, 1);
      assert.equal(data.impact!.by_surface.mem, 1);

      const text = renderDigestText(data);
      assert.ok(text.includes("FAPONY IMPACT"), "text section");
      assert.ok(
        text.includes("hints fired: 2 (read 1 · debt 0 · mem 1 · commit 0)"),
        "per-surface counts",
      );
      assert.ok(
        text.includes("not proof the agent acted"),
        "limitation note is always present",
      );
      const src = data.sources.find((s) => s.name === "hint-log");
      assert.ok(src?.ok, "hint-log source ok when log exists");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
  console.log("  ✓ impact section — log counters render + hint-log source ok");
});

test("testDigestImpactNoLog", async () => {
  await withIsolatedEnv(async () => {
    const dir = makeWorktree();
    try {
      const data = await collectDigest({ worktree: dir });
      assert.equal(data.impact, null, "no log → null, not zeroed object");
      const text = renderDigestText(data);
      assert.ok(
        text.includes("(no hints recorded)"),
        "explicit no-data line, not a silent 0",
      );
      const src = data.sources.find((s) => s.name === "hint-log");
      assert.ok(src && !src.ok, "hint-log source !ok without a log");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
  console.log("  ✓ impact section — no log reads as no-data, not zero");
});

test("testDigestBugOpenClose", async () => {
  await withIsolatedEnv(async () => {
    const dir = makeWorktree();
    try {
      const now = Date.now();
      writeMemLog(dir, [
        {
          ts: new Date(now - 3000).toISOString(),
          agent: "a",
          kind: "bug",
          text: "bug A",
          id: "b1",
        },
        {
          ts: new Date(now - 2000).toISOString(),
          agent: "a",
          kind: "bug",
          text: "bug B",
          id: "b2",
        },
        {
          ts: new Date(now - 1000).toISOString(),
          agent: "a",
          kind: "close",
          ref: "b1",
          text: "fixed",
        },
      ]);

      const data = await collectDigest({ worktree: dir });
      assert.equal(data.bugs.open.length, 1, "one bug should be open");
      assert.equal(data.bugs.open[0].id, "b2");
      assert.equal(data.bugs.closed.length, 1, "one bug should be closed");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
  console.log("  ✓ bug open/close classification");
});
