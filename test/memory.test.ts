import assert from "node:assert";
import { execSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Config } from "../src/db/index.js";
import { initStore, put } from "../src/mem/store.js";
import {
  claimMemory,
  DEFAULT_MEMORY,
  readMemLog,
  readRecentMemDecisions,
  resolveMemDir,
  resolveMemoryConfig,
  whereMemDir,
} from "../src/memory.js";
import { baseConfig, withTempRepo } from "./helpers.js";

export function testMemoryDefaultWiringWithDir(): void {
  const dir = mkdtempSync(join(tmpdir(), "fapony-mem-"));
  try {
    // the mem dir alone is enough now — `fapony init` creates it empty and the
    // code is built in, so no mem.ts is scaffolded (PLAN-agent-one-call)
    mkdirSync(join(dir, ".fapony", ".memory"), { recursive: true });

    const result = resolveMemoryConfig(baseConfig(), dir);
    assert.deepEqual(result, DEFAULT_MEMORY);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }

  console.log("  ✓ memory default-wiring with empty .fapony/.memory/");
}

export function testMemoryDefaultWiringNoDir(): void {
  const dir = mkdtempSync(join(tmpdir(), "fapony-mem-"));
  try {
    const result = resolveMemoryConfig(baseConfig(), dir);
    assert.equal(result, null);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }

  console.log("  ✓ memory default-wiring without any .fapony/.memory/");
}

export function testMemoryExplicitConfigWins(): void {
  const dir = mkdtempSync(join(tmpdir(), "fapony-mem-"));
  try {
    const memDir = join(dir, ".fapony", ".memory");
    mkdirSync(memDir, { recursive: true });
    writeFileSync(join(memDir, "mem.ts"), "// stub");

    const explicitConfig: Config = {
      ...baseConfig(),
      memory: {
        claim: ["custom", "claim", "{id}"],
        close: ["custom", "close", "{id}", "{msg}"],
        add: ["custom", "add", "{kind}", "{text}"],
      },
    };

    const result = resolveMemoryConfig(explicitConfig, dir);
    assert.deepEqual(result, explicitConfig.memory);
    assert.notDeepEqual(result, DEFAULT_MEMORY);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }

  console.log("  ✓ memory explicit config wins over default");
}

export function testClaimMemoryFailGracefully(): void {
  // Config with a claim command that always fails ("false" exits 1)
  const failingConfig: Config = {
    ...baseConfig(),
    memory: {
      claim: ["false"],
      close: ["true"],
      add: ["true"],
    },
  };

  const result = claimMemory(failingConfig, "/tmp", "test-id");
  assert.equal(result, false, "should return false when shell command fails");

  // No memory config → returns false
  const noMemResult = claimMemory(baseConfig(), "/tmp", "test-id");
  assert.equal(noMemResult, false, "should return false when memory is null");

  console.log("  ✓ claimMemory fails gracefully");
}

// Regression: execSync must have timeout so hanging scripts don't block the process.
// "sleep 999" should complete in ~15s (timeout), not 999s (the sleep duration).
export function testClaimMemoryTimeout(): void {
  const hangingConfig: Config = {
    ...baseConfig(),
    memory: {
      claim: ["sleep", "999"],
      close: ["true"],
      add: ["true"],
    },
  };

  const start = Date.now();
  const result = claimMemory(hangingConfig, "/tmp", "test-id");
  const elapsed = Date.now() - start;

  assert.equal(result, false, "should return false for hanging command");
  // Should complete in ~15s (timeout), not 999s (the sleep)
  if (elapsed > 20_000) {
    throw new Error(
      `timeout test took too long: ${elapsed}ms — execSync may be hanging`,
    );
  }

  console.log("  ✓ claimMemory timeout prevents hang");
}

export function testMemoryReadRecentDecisions(): void {
  const dir = mkdtempSync(join(tmpdir(), "fapony-mem-log-"));
  try {
    const memDir = join(dir, ".fapony", ".memory");
    mkdirSync(memDir, { recursive: true });
    const rows = [
      {
        ts: "2026-01-01T00:00:00.000Z",
        id: "a",
        kind: "decision",
        text: "old decision",
      },
      { ts: "2026-01-02T00:00:00.000Z", id: "b", kind: "bug", text: "a bug" },
      {
        ts: "2026-01-03T00:00:00.000Z",
        id: "c",
        kind: "decision",
        text: "newer decision",
      },
      {
        ts: "2026-01-04T00:00:00.000Z",
        id: "d",
        kind: "decision",
        text: "newest decision",
      },
    ];
    writeFileSync(
      join(memDir, "log.jsonl"),
      `${rows.map((r) => JSON.stringify(r)).join("\n")}\n`,
    );

    const got = readRecentMemDecisions(dir, 2);
    assert.equal(got.length, 2, "respects limit");
    assert.equal(got[0].text, "newest decision", "newest first");
    assert.equal(got[1].text, "newer decision");
    assert.ok(
      !got.some((r) => r.kind === "bug"),
      "non-decision rows filtered out",
    );

    // keyword is a preference: a matching older row jumps the recency order
    const hit = readRecentMemDecisions(dir, 1, ["old decision"]);
    assert.equal(hit[0].text, "old decision");

    // no match → falls back to recent rather than going silent
    const fallback = readRecentMemDecisions(dir, 1, ["no-such-keyword"]);
    assert.equal(fallback[0].text, "newest decision");

    // missing log → empty, never throws
    assert.deepEqual(readRecentMemDecisions("/nonexistent/worktree", 3), []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  console.log("  ✓ readRecentMemDecisions filters, ranks, and degrades");
}

export function testMemoryReadRecentDecisionsMonorepo(): void {
  const root = mkdtempSync(join(tmpdir(), "fapony-mono-"));
  try {
    const memDir = join(root, "apps", "vela", ".fapony", ".memory");
    mkdirSync(memDir, { recursive: true });
    writeFileSync(
      join(memDir, "log.jsonl"),
      `${JSON.stringify({
        ts: "2026-01-01T00:00:00.000Z",
        id: "a",
        kind: "decision",
        text: "app-scoped decision",
      })}\n`,
    );
    // The run history is keyed to the monorepo root, but the log lives in the
    // app dir — the reader must find it via walk-up from the app path.
    // readMemLog walks up from root → finds apps/vela/.fapony/.memory/ only if
    // we call it from within the app. From root itself, repo-root fallback applies.
    const got = readRecentMemDecisions(join(root, "apps", "vela"), 3);
    assert.equal(got.length, 1);
    assert.equal(
      got[0].text,
      "app-scoped decision",
      "mem dir resolved via walk-up to <root>/apps/<app>/.fapony/.memory",
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
  console.log(
    "  ✓ readRecentMemDecisions finds the app-scoped log in a monorepo",
  );
}

// Regression 2026-09-19: readMemLog skipped log.YYYY-MM-DD.jsonl, so the day a
// repo crossed the rotate threshold mem_find forgot every archived row — the
// closed ones, which is most of what recall is for.
export function testReadMemLogIncludesRotatedArchives(): void {
  const dir = mkdtempSync(join(tmpdir(), "fapony-memrotate-"));
  try {
    const memDir = join(dir, ".fapony", ".memory");
    mkdirSync(memDir, { recursive: true });
    writeFileSync(
      join(memDir, "log.jsonl"),
      `${JSON.stringify({ ts: "2026-09-19T00:00:00.000Z", agent: "a", kind: "note", text: "live row" })}\n`,
    );
    writeFileSync(
      join(memDir, "log.2026-03-01.jsonl"),
      `${JSON.stringify({ ts: "2026-03-01T00:00:00.000Z", agent: "a", kind: "bug", text: "archived row" })}\n`,
    );

    const r = readMemLog(dir);
    assert.equal(r.filesFound, 2, "rotated archive must be read");
    assert.deepEqual(r.rows.map((x) => x.text).sort(), [
      "archived row",
      "live row",
    ]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  console.log("  ✓ readMemLog reads rotated archives, not just the live log");
}

// Regression 2026-09-19 (review-pony): walk-up climbed past the git root, so a
// repo nested under another checkout resolved to the parent's log and wrote the
// row outside the repo. SPEC §1: step 3/4 stop at the repo root.
export function testMemDirWalkStopsAtRepoRoot(): void {
  const outer = mkdtempSync(join(tmpdir(), "fapony-outer-"));
  try {
    mkdirSync(join(outer, ".fapony", ".memory"), { recursive: true });
    writeFileSync(join(outer, ".fapony", ".memory", "log.jsonl"), "");
    const inner = join(outer, "inner");
    mkdirSync(join(inner, "sub"), { recursive: true });
    execSync("git init", { cwd: inner, stdio: "ignore" });

    assert.equal(
      resolveMemDir(join(inner, "sub")),
      null,
      "walk-up must stop at the repo root, never resolve to a parent checkout",
    );
    assert.equal(whereMemDir(join(inner, "sub")).step, "none");
  } finally {
    rmSync(outer, { recursive: true, force: true });
  }
  console.log("  ✓ mem dir walk stops at the repo root");
}

// Regression 2026-09-19 (review-pony): an empty .fapony/.memory/ (what
// `fapony init` scaffolds) counted as a candidate and shadowed the ancestor
// that held the real log. SPEC §1: a dir without a log*.jsonl is not a hit.
export function testMemDirSkipsEmptyCandidate(): void {
  withTempRepo((repo) => {
    mkdirSync(join(repo, ".fapony", ".memory"), { recursive: true });
    writeFileSync(join(repo, ".fapony", ".memory", "log.jsonl"), "");
    mkdirSync(join(repo, "apps", "x", ".fapony", ".memory"), {
      recursive: true,
    });
    assert.equal(
      resolveMemDir(join(repo, "apps", "x")),
      join(repo, ".fapony", ".memory"),
      "an empty .fapony/.memory/ must not shadow the ancestor holding the log",
    );
  });
  console.log("  ✓ mem dir skips an empty .fapony/.memory/ candidate");
}

// Regression 2026-09-19 (review-pony): paths.memDir was read from
// cwd/fapony.config.json and joined to cwd. SPEC §1: it lives at the repo root
// and is relative to the repo root, so it must work from a subdirectory.
export function testMemDirConfigIsRepoRootRelative(): void {
  withTempRepo((repo) => {
    mkdirSync(join(repo, "apps", "y"), { recursive: true });
    mkdirSync(join(repo, "shared", "mem"), { recursive: true });
    writeFileSync(join(repo, "shared", "mem", "log.jsonl"), "");
    writeFileSync(
      join(repo, "fapony.config.json"),
      `${JSON.stringify({ paths: { memDir: "shared/mem" } })}\n`,
    );
    assert.equal(
      resolveMemDir(join(repo, "apps", "y")),
      join(repo, "shared", "mem"),
      "paths.memDir is read from the repo root and relative to it, not to cwd",
    );
  });
  console.log("  ✓ paths.memDir resolves relative to the repo root");
}

// Regression 2026-09-19 (review-pony): `mem where` never saw --mem-dir (stripped
// before dispatch) and the writer silently fell back to the default on a bad
// path. Both must treat the flag as a promise, not a hint.
// Regression 2026-09-20 (review-pony): with two app-scoped logs and nothing at
// the repo root, the resolver returned "none" and the writer silently created a
// third log at <root>/.fapony/.memory/ that no app-scoped reader would see.
// SPEC §1 fail example: refuse with both paths.
export function testMemDirAmbiguousRefusesWrite(): void {
  withTempRepo((repo) => {
    for (const app of ["vela", "mdl"]) {
      const dir = join(repo, "apps", app, ".fapony", ".memory");
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, "log.jsonl"), "");
    }
    const got = whereMemDir(repo);
    assert.equal(got.step, "ambiguous");
    assert.equal(got.candidates?.length, 2);
    initStore(repo);
    assert.throws(
      () => put({ id: "x", kind: "note", text: "t", files: ["a.ts"] }),
      /refusing to guess/,
      "the writer must refuse two app-scoped logs, not start a third at the root",
    );
  });
  console.log(
    "  ✓ two app-scoped mem dirs at the repo root → refuse, never guess",
  );
}

// Regression 2026-09-21: with ONE app-scoped log and nothing at/above cwd the
// resolver returned "none" with no trace of it, so the Stop hook told the agent
// "nothing recorded in this project yet" while apps/vela/.fapony/.memory held
// rows. Resolution is unchanged (one candidate is not ambiguous) — the
// candidate just travels back so callers can say out-of-scope, not absent.
export function testMemDirSingleOutOfScopeReportsCandidate(): void {
  withTempRepo((repo) => {
    const dir = join(repo, "apps", "vela", ".fapony", ".memory");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "log.jsonl"), "");
    const got = whereMemDir(repo);
    assert.equal(got.dir, null, "one app-scoped log is still out of scope");
    assert.notEqual(got.step, "ambiguous", "one candidate is not ambiguous");
    assert.deepEqual(got.candidates, [dir], "the path must come back");
  });
  console.log("  ✓ one out-of-scope mem dir comes back as a candidate");
}

export function testMemDirOverrideWinsAndRefusesMissing(): void {
  withTempRepo((repo) => {
    mkdirSync(join(repo, ".fapony", ".memory"), { recursive: true });
    writeFileSync(join(repo, ".fapony", ".memory", "log.jsonl"), "");
    const custom = join(repo, "custom-mem");
    mkdirSync(custom, { recursive: true });
    writeFileSync(join(custom, "log.jsonl"), "");

    const won = whereMemDir(repo, custom);
    assert.equal(won.dir, custom, "--mem-dir must win over the walked-up dir");
    assert.equal(won.step, "flag");

    const missing = join(repo, "nope");
    assert.equal(whereMemDir(repo, missing).dir, null);
    assert.throws(
      () => initStore(repo, missing),
      /--mem-dir/,
      "the writer must refuse a missing --mem-dir, not fall back to the default",
    );
  });
  console.log("  ✓ --mem-dir wins and a missing path is refused, not ignored");
}
