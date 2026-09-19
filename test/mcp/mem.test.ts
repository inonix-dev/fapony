// test/mcp/mem.test.ts — mem_find tool (PLAN-mem-mcp chunk 2, SPEC §1–§5)
import assert from "node:assert";
import {
  appendFileSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { memAdd, memFind, toolMemFind } from "../../src/mcp/tools/mem.js";
import { parseToolResult } from "../../src/mcp/types.js";

function writeLog(dir: string, rows: object[]): string {
  const memDir = join(dir, ".fapony", ".memory");
  mkdirSync(memDir, { recursive: true });
  writeFileSync(
    join(memDir, "log.jsonl"),
    `${rows.map((r) => JSON.stringify(r)).join("\n")}\n`,
  );
  return memDir;
}

export function testMemFindReturnsAllKindsNoDefaultFilter(): void {
  // chunk 0 → A: every kind is live, so omitting kind must return
  // decision AND bookkeeping kinds (spec §5.2) — a default filter here
  // would enforce the retracted "deprecated" prose.
  const dir = mkdtempSync(join(tmpdir(), "fapony-memfind-"));
  try {
    writeLog(dir, [
      {
        ts: "2026-01-01T00:00:00.000Z",
        agent: "a",
        kind: "decision",
        text: "use tx",
      },
      {
        ts: "2026-01-02T00:00:00.000Z",
        agent: "a",
        kind: "synced",
        text: "sync",
      },
      {
        ts: "2026-01-03T00:00:00.000Z",
        agent: "a",
        kind: "next",
        text: "next up",
      },
      {
        ts: "2026-01-04T00:00:00.000Z",
        agent: "a",
        kind: "claim",
        text: "claim 1",
      },
    ]);
    const r = memFind({ worktree: dir });
    assert.equal(r.total, 4, "no default kind filter");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  console.log("  ✓ mem_find returns every kind (no default filter)");
}

export function testMemFindFiltersAndMatchesFiles(): void {
  const dir = mkdtempSync(join(tmpdir(), "fapony-memfind-"));
  try {
    writeLog(dir, [
      {
        ts: "2026-01-01T00:00:00.000Z",
        agent: "a",
        kind: "decision",
        text: "summary uses tx",
        spec: "apps/vela/src/booking/summary.ts",
      },
      {
        ts: "2026-01-02T00:00:00.000Z",
        agent: "a",
        kind: "bug",
        text: "unrelated",
      },
    ]);
    const r = memFind({
      worktree: dir,
      files: ["apps/vela/src/booking/summary.ts"],
    });
    assert.equal(r.total, 1, "files[] matches via text/spec/ref substring");
    assert.equal(r.rows[0].kind, "decision");

    const byKind = memFind({ worktree: dir, kind: ["bug"] });
    assert.equal(byKind.total, 1);
    assert.equal(byKind.rows[0].kind, "bug");

    const byText = memFind({ worktree: dir, text: "TX" }); // case-insensitive
    assert.equal(byText.total, 1);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  console.log("  ✓ mem_find filters by kind, text, and files[]");
}

export function testMemFindTotalVsLimitAndFailShapes(): void {
  // spec §4 fail examples: total-before-limit, memDir for existing mem,
  // skipped counts bad lines — never a silent empty.
  const dir = mkdtempSync(join(tmpdir(), "fapony-memfind-"));
  try {
    const rows = Array.from({ length: 30 }, (_, i) => ({
      ts: `2026-01-${String((i % 28) + 1).padStart(2, "0")}T00:00:00.000Z`,
      agent: "a",
      kind: "note",
      text: `row ${i}`,
    }));
    const memDir = writeLog(dir, rows);
    appendFileSync(join(memDir, "log.jsonl"), 'not-json\n{"kind":"x"}\n');

    const r = memFind({ worktree: dir, limit: 20 });
    assert.equal(r.total, 30, "total counts matches before limit");
    assert.equal(r.rows.length, 20, "rows respect limit");
    assert.equal(r.skipped, 2, "malformed lines counted, not swallowed");
    assert.equal(r.filesFound, 1);
    assert.ok(r.memDir, "memDir present when mem exists");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }

  // No mem at all → memDir:null, not just rows:[] (spec §4 table row 1)
  const empty = memFind({ worktree: "/nonexistent/wt-vela" });
  assert.equal(empty.memDir, null);
  assert.equal(empty.filesFound, 0);
  assert.deepEqual(empty.rows, []);
  console.log(
    "  ✓ mem_find distinguishes no-mem from no-match, counts skipped",
  );
}

export function testMemFindToolValidation(): void {
  // spec §4: bare/non-absolute worktree = explicit error, never silent empty
  const err = toolMemFind({ worktree: "wt-vela" });
  assert.equal(err.isError, true);

  const missing = toolMemFind({});
  assert.equal(missing.isError, true);

  const ok = parseToolResult(toolMemFind({ worktree: "/nonexistent" })) as {
    memDir: string | null;
  };
  assert.equal(ok.memDir, null);
  console.log("  ✓ mem_find rejects bare worktree names with a clear error");
}

// Rows written by `mem add --files` carry structured files[]; the query must
// hit them without the path appearing in the prose (regression 2026-09-19 —
// the field CLAUDE.md rule 7 calls mandatory was not searchable at all).
export function testMemFindMatchesStoredFiles(): void {
  const dir = mkdtempSync(join(tmpdir(), "fapony-memfind-files-"));
  try {
    writeLog(dir, [
      {
        ts: "2026-09-19T00:00:00.000Z",
        agent: "a",
        kind: "decision",
        text: "wrapper lives in the service layer now",
        files: ["src/deep/zone/handler.ts"],
      },
    ]);
    assert.equal(
      memFind({ worktree: dir, files: ["src/deep/zone/handler.ts"] }).total,
      1,
    );
    assert.equal(
      memFind({ worktree: dir, files: ["handler.ts"] }).total,
      1,
      "repo-relative suffix still matches",
    );
    assert.equal(memFind({ worktree: dir, files: ["src/other.ts"] }).total, 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  console.log("  ✓ mem_find matches rows by stored files[]");
}

// Regression 2026-09-19 (review-pony): mem_add resolved its mem dir by walking
// up from the worktree while mem_find guesses the app dir — in a monorepo the
// row landed at the git root, where nothing reads it. Writer and reader must
// use the same guess (MEM_APP stands in for the app name here).
export function testMemAddWritesWhereMemFindReads(): void {
  const dir = mkdtempSync(join(tmpdir(), "fapony-memadd-"));
  const prevApp = process.env.MEM_APP;
  process.env.MEM_APP = "vela";
  try {
    writeLog(join(dir, "apps", "vela"), [
      {
        ts: "2026-01-01T00:00:00.000Z",
        agent: "old",
        kind: "decision",
        text: "pre-existing app-scoped row",
      },
    ]);
    const added = memAdd({
      worktree: dir,
      kind: "note",
      text: "written through the MCP writer",
      files: ["apps/vela/src/x.ts"],
    });
    const found = memFind({ worktree: dir, files: ["apps/vela/src/x.ts"] });
    assert.equal(found.total, 1, "mem_add row must be visible to mem_find");
    assert.equal(found.rows[0].id, added.id);
    assert.ok(
      found.memDir?.includes(join("apps", "vela", ".fapony", ".memory")),
      `row must land in the app-scoped log, got ${found.memDir}`,
    );
  } finally {
    if (prevApp === undefined) delete process.env.MEM_APP;
    else process.env.MEM_APP = prevApp;
    rmSync(dir, { recursive: true, force: true });
  }
  console.log("  ✓ mem_add writes where mem_find reads (app-scoped layout)");
}

// files is the field the whole feature exists to populate, so the write path
// must reject a row that omits it — the same required+reject gate as the schema.
export function testMemAddRejectsMissingFilesAndBadKind(): void {
  const dir = mkdtempSync(join(tmpdir(), "fapony-memadd-"));
  try {
    assert.throws(
      () => memAdd({ worktree: dir, kind: "note", text: "x", files: [] }),
      /files/,
    );
    assert.throws(
      () => memAdd({ worktree: dir, kind: "nope", text: "x", files: ["a.ts"] }),
      /kind/,
    );
    assert.throws(
      () => memAdd({ worktree: dir, kind: "hold", text: "x", files: ["a.ts"] }),
      /spec/,
      "hold without a spec must be rejected like the CLI",
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  console.log("  ✓ mem_add rejects no files / bad kind / hold without spec");
}

// Regression 2026-09-19: agent/person both fell back to the literal "unknown",
// and a generic OS account (admin/user/owner — what a fresh install offers) was
// taken at face value, so two different people wrote one indistinguishable
// file. With no git identity available at all, the last resort must still be
// unique per machine.
export function testMemIdentityNeverCollapsesToUnknown(): void {
  const dir = mkdtempSync(join(tmpdir(), "fapony-memid-"));
  const saved = {
    USER: process.env.USER,
    MEM_AGENT: process.env.MEM_AGENT,
    g: process.env.GIT_CONFIG_GLOBAL,
    sys: process.env.GIT_CONFIG_NOSYSTEM,
  };
  process.env.USER = "admin";
  delete process.env.MEM_AGENT;
  // no git identity anywhere — the machine tag is all that is left
  const emptyCfg = join(dir, "empty.gitconfig");
  writeFileSync(emptyCfg, "");
  process.env.GIT_CONFIG_GLOBAL = emptyCfg;
  process.env.GIT_CONFIG_NOSYSTEM = "1";
  try {
    memAdd({
      worktree: dir,
      kind: "note",
      text: "row written with no usable identity",
      files: ["src/x.ts"],
    });
    const found = memFind({ worktree: dir, files: ["src/x.ts"] });
    assert.equal(found.total, 1);
    assert.match(
      found.rows[0].agent ?? "",
      /^m-[0-9a-f]{8}$/,
      "generic $USER must fall through to the machine tag, not be used as-is",
    );
    const names = readdirSync(found.memDir as string);
    assert.ok(
      names.some((f) => /^log\.m-[0-9a-f]{8}\.jsonl$/.test(f)),
      `filename must be machine-unique, got ${names.join(", ")}`,
    );
  } finally {
    for (const [k, v] of Object.entries({
      USER: saved.USER,
      MEM_AGENT: saved.MEM_AGENT,
      GIT_CONFIG_GLOBAL: saved.g,
      GIT_CONFIG_NOSYSTEM: saved.sys,
    }))
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    rmSync(dir, { recursive: true, force: true });
  }
  console.log("  ✓ mem identity falls back to a machine tag, never 'unknown'");
}
