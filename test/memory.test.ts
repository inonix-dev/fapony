import assert from "node:assert";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Config } from "../src/db/index.js";
import {
  claimMemory,
  DEFAULT_MEMORY,
  readRecentMemDecisions,
  resolveMemoryConfig,
} from "../src/memory.js";
import { baseConfig } from "./helpers.js";

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
  const prevApp = process.env.MEM_APP;
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
    // app dir — the reader must find it from the root, like mem.ts does.
    process.env.MEM_APP = "vela";

    const got = readRecentMemDecisions(root, 3);
    assert.equal(got.length, 1);
    assert.equal(
      got[0].text,
      "app-scoped decision",
      "mem dir resolved under <root>/apps/<app>/.fapony/.memory",
    );
  } finally {
    if (prevApp === undefined) delete process.env.MEM_APP;
    else process.env.MEM_APP = prevApp;
    rmSync(root, { recursive: true, force: true });
  }
  console.log(
    "  ✓ readRecentMemDecisions finds the app-scoped log in a monorepo",
  );
}
