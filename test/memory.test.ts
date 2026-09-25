import { test } from "bun:test";
import assert from "node:assert";
import { execSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Config } from "../src/core/config.js";
import { initStore, put } from "../src/mem/store.js";
import {
  claimMemory,
  DEFAULT_MEMORY,
  readMemLog,
  resolveMemDir,
  resolveMemoryConfig,
  whereMemDir,
} from "../src/memory.js";
import { baseConfig, withTempRepo } from "./helpers.js";

test("testMemoryDefaultWiringWithDir", () => {
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
});

test("testMemoryDefaultWiringNoDir", () => {
  const dir = mkdtempSync(join(tmpdir(), "fapony-mem-"));
  try {
    const result = resolveMemoryConfig(baseConfig(), dir);
    assert.equal(result, null);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }

  console.log("  ✓ memory default-wiring without any .fapony/.memory/");
});

test("testMemoryExplicitConfigWins", () => {
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
});

test("testClaimMemoryFailGracefully", () => {
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
});

// Regression: execSync must have timeout so hanging scripts don't block the process.
// "sleep 999" should complete in ~1s (injected timeout), not 999s (the sleep duration).
// Production default stays 15s — the param exists so this test doesn't pay it.
test("testClaimMemoryTimeout", () => {
  const hangingConfig: Config = {
    ...baseConfig(),
    memory: {
      claim: ["sleep", "999"],
      close: ["true"],
      add: ["true"],
    },
  };

  const start = Date.now();
  const result = claimMemory(hangingConfig, "/tmp", "test-id", 1_000);
  const elapsed = Date.now() - start;

  assert.equal(result, false, "should return false for hanging command");
  // Should complete in ~1s (timeout), not 999s (the sleep)
  if (elapsed > 5_000) {
    throw new Error(
      `timeout test took too long: ${elapsed}ms — execSync may be hanging`,
    );
  }

  console.log("  ✓ claimMemory timeout prevents hang");
});

// Regression 2026-09-19: readMemLog skipped log.YYYY-MM-DD.jsonl, so the day a
// repo crossed the rotate threshold mem_find forgot every archived row — the
// closed ones, which is most of what recall is for.
test("testReadMemLogIncludesRotatedArchives", () => {
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
});

// Regression 2026-09-19 (review-pony): walk-up climbed past the git root, so a
// repo nested under another checkout resolved to the parent's log and wrote the
// row outside the repo. SPEC §1: step 3/4 stop at the repo root.
test("testMemDirWalkStopsAtRepoRoot", () => {
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
});

// Regression 2026-09-19 (review-pony): an empty .fapony/.memory/ (what
// `fapony init` scaffolds) counted as a candidate and shadowed the ancestor
// that held the real log. SPEC §1: a dir without a log*.jsonl is not a hit.
test("testMemDirSkipsEmptyCandidate", () => {
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
});

// Regression 2026-09-19 (review-pony): paths.memDir was read from
// cwd/fapony.config.json and joined to cwd. SPEC §1: it lives at the repo root
// and is relative to the repo root, so it must work from a subdirectory.
test("testMemDirConfigIsRepoRootRelative", () => {
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
});

// Regression 2026-09-19 (review-pony): `mem where` never saw --mem-dir (stripped
// before dispatch) and the writer silently fell back to the default on a bad
// path. Both must treat the flag as a promise, not a hint.
// Regression 2026-09-20 (review-pony): with two app-scoped logs and nothing at
// the repo root, the resolver returned "none" and the writer silently created a
// third log at <root>/.fapony/.memory/ that no app-scoped reader would see.
// SPEC §1 fail example: refuse with both paths.
test("testMemDirAmbiguousRefusesWrite", () => {
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
});

// Regression 2026-09-21: with ONE app-scoped log and nothing at/above cwd the
// resolver returned "none" with no trace of it, so the Stop hook told the agent
// "nothing recorded in this project yet" while apps/vela/.fapony/.memory held
// rows. Resolution is unchanged (one candidate is not ambiguous) — the
// candidate just travels back so callers can say out-of-scope, not absent.
test("testMemDirSingleOutOfScopeReportsCandidate", () => {
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
});

test("testMemDirOverrideWinsAndRefusesMissing", () => {
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
});
