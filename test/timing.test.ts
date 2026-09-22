import { test } from "bun:test";
// test/timing.test.ts — session timing extraction (PLAN-project-health-context step 3)
//
// Covers: parseTimeMs units, extractPartTiming field paths (spec §1),
// rowFallbackMs, summarizeTiming averages (never sums), and detail:true
// integration for OpenCode / ZCode / Claude Code fixture data.

import { Database } from "bun:sqlite";
import assert from "node:assert";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  collectTiming,
  extractPartTiming,
  parseTimeMs,
  readClaudeCodeUsage,
  readPassiveUsage,
  readZcodeUsage,
  rowFallbackMs,
  summarizeTiming,
} from "../src/session/index.js";

// ─── parseTimeMs ─────────────────────────────────────────────────────

test("testParseTimeMsUnits", () => {
  assert.equal(parseTimeMs("2026-09-09T03:00:00.000Z"), 1788922800000);
  assert.equal(parseTimeMs(1788922800000), 1788922800000); // epoch-ms
  assert.equal(parseTimeMs(1788922800), 1788922800000); // epoch-s
  assert.equal(parseTimeMs("garbage"), null);
  assert.equal(parseTimeMs(null), null);
  assert.equal(parseTimeMs(undefined), null);
  assert.equal(parseTimeMs(-5), null);
  console.log("  ✓ parseTimeMs handles ISO/ms/s/garbage");
});

// ─── extractPartTiming ───────────────────────────────────────────────

test("testExtractPartTimingToolPart", () => {
  const t = extractPartTiming(
    JSON.stringify({
      type: "tool",
      tool: "read",
      time: {
        start: "2026-09-09T03:00:00.000Z",
        end: "2026-09-09T03:00:01.000Z",
      },
      state: {
        time: {
          start: "2026-09-09T03:00:00.100Z",
          end: "2026-09-09T03:00:00.500Z",
        },
      },
    }),
  );
  assert.equal(t.partType, "tool");
  assert.equal(t.toolName, "read");
  assert.equal(t.durationMs, 1000);
  assert.equal(t.toolLatencyMs, 400);
  assert.equal(t.stepInput, null);
  console.log("  ✓ extractPartTiming reads data.time + data.state.time");
});

test("testExtractPartTimingStepFinish", () => {
  const t = extractPartTiming(
    JSON.stringify({
      type: "step-finish",
      tokens: { input: 1000, output: 200, reasoning: 50, cache: 10 },
      cost: 0.01,
    }),
  );
  assert.equal(t.partType, "step-finish");
  assert.equal(t.stepInput, 1000);
  assert.equal(t.stepOutput, 200);
  assert.equal(t.stepCost, 0.01);
  assert.equal(t.durationMs, null);
  console.log("  ✓ extractPartTiming reads step-finish tokens + cost");
});

test("testExtractPartTimingMalformed", () => {
  for (const bad of ["not json", "42", "null", '{"time":{"start":"x"}}']) {
    const t = extractPartTiming(bad);
    assert.equal(t.durationMs, null);
    assert.equal(t.toolLatencyMs, null);
    assert.equal(t.stepInput, null);
  }
  // inverted time range is not a duration
  const inv = extractPartTiming(
    JSON.stringify({ type: "tool", time: { start: 2000, end: 1000 } }),
  );
  assert.equal(inv.durationMs, null);
  console.log("  ✓ extractPartTiming degrades to nulls on bad input");
});

// ─── rowFallbackMs ───────────────────────────────────────────────────

test("testRowFallbackMsVariants", () => {
  assert.equal(rowFallbackMs(1700000000, 1700000005), 5000); // seconds → ms
  assert.equal(rowFallbackMs(1700000000000, 1700000000500), 500); // ms passthrough
  assert.equal(rowFallbackMs(100, 100), 0);
  assert.equal(rowFallbackMs(200, 100), null); // inverted
  assert.equal(rowFallbackMs(null, 100), null);
  assert.equal(rowFallbackMs(100, null), null);
  console.log("  ✓ rowFallbackMs handles seconds/ms/inverted/missing");
});

// ─── summarizeTiming ─────────────────────────────────────────────────

test("testSummarizeTimingAverages", () => {
  const s = summarizeTiming({
    durationsMs: [1000, 2000, null],
    stepTokens: [
      { input: 1000, output: 200, cost: 0.01 },
      { input: 2000, output: 400, cost: 0.03 },
    ],
    toolLatencies: [
      { tool: "read", ms: 100 },
      { tool: "read", ms: 300 },
      { tool: "bash", ms: 500 },
    ],
    steps: 2,
  });
  assert.equal(s.steps, 2);
  assert.equal(s.avgStepMs, 1500);
  assert.equal(s.stepSamples, 2);
  assert.equal(s.avgStepInput, 1500);
  assert.equal(s.avgStepOutput, 300);
  assert.equal(s.avgStepCost, 0.02);
  assert.deepEqual(s.toolLatencyMsByType.read, { count: 2, avgMs: 200 });
  assert.deepEqual(s.toolLatencyMsByType.bash, { count: 1, avgMs: 500 });
  // Per-step tokens must never be summed anywhere in the output.
  const blob = JSON.stringify(s);
  assert(!blob.includes("3000"), "no summed input tokens");
  assert(!blob.includes("600"), "no summed output tokens");
  console.log("  ✓ summarizeTiming averages, never sums");
});

test("testSummarizeTimingEmpty", () => {
  const s = summarizeTiming({
    durationsMs: [],
    stepTokens: [],
    toolLatencies: [],
    steps: 0,
  });
  assert.equal(s.avgStepMs, null);
  assert.equal(s.stepSamples, 0);
  assert.equal(s.avgStepInput, null);
  assert.deepEqual(s.toolLatencyMsByType, {});
  console.log("  ✓ summarizeTiming empty → nulls, not NaN");
});

// ─── OpenCode integration ────────────────────────────────────────────

function withTimingDb(fn: (dbPath: string) => void): void {
  const dir = mkdtempSync(join(tmpdir(), "fapony-timing-"));
  const dbPath = join(dir, "opencode.db");
  const db = new Database(dbPath);
  try {
    db.run(
      `CREATE TABLE project (id TEXT PRIMARY KEY, worktree TEXT NOT NULL)`,
    );
    db.run(
      `CREATE TABLE session (id TEXT PRIMARY KEY, project_id TEXT NOT NULL, model TEXT, time_created INTEGER NOT NULL, tokens_input INTEGER DEFAULT 0, tokens_output INTEGER DEFAULT 0, tokens_reasoning INTEGER DEFAULT 0, tokens_cache_read INTEGER DEFAULT 0, tokens_cache_write INTEGER DEFAULT 0, cost REAL DEFAULT 0)`,
    );
    db.run(
      `CREATE TABLE part (id TEXT PRIMARY KEY, message_id TEXT NOT NULL, session_id TEXT NOT NULL, time_created INTEGER NOT NULL, time_updated INTEGER NOT NULL, data TEXT NOT NULL)`,
    );
    db.prepare(`INSERT INTO project (id, worktree) VALUES (?, ?)`).run(
      "p1",
      "/tmp/wt1",
    );
    db.prepare(
      `INSERT INTO session (id, project_id, model, time_created, tokens_input, tokens_output, cost) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).run("s1", "p1", "m1", 1000, 100, 50, 0.01);

    const part = db.prepare(
      `INSERT INTO part (id, message_id, session_id, time_created, time_updated, data) VALUES (?, ?, ?, ?, ?, ?)`,
    );
    // tool part with embedded time (1s) + tool latency (400ms)
    part.run(
      "p1",
      "m1",
      "s1",
      1700000000,
      1700000001,
      JSON.stringify({
        type: "tool",
        tool: "read",
        time: {
          start: "2026-09-09T03:00:00.000Z",
          end: "2026-09-09T03:00:01.000Z",
        },
        state: {
          time: {
            start: "2026-09-09T03:00:00.100Z",
            end: "2026-09-09T03:00:00.500Z",
          },
        },
      }),
    );
    // reasoning part with embedded time only (2s)
    part.run(
      "p2",
      "m1",
      "s1",
      1700000000,
      1700000002,
      JSON.stringify({
        type: "reasoning",
        time: {
          start: "2026-09-09T03:00:02.000Z",
          end: "2026-09-09T03:00:04.000Z",
        },
      }),
    );
    // tool part WITHOUT embedded time → row fallback (5s)
    part.run(
      "p3",
      "m1",
      "s1",
      1700000010,
      1700000015,
      JSON.stringify({ type: "tool", tool: "bash" }),
    );
    // step-finish with tokens
    part.run(
      "p4",
      "m1",
      "s1",
      1700000020,
      1700000020,
      JSON.stringify({
        type: "step-finish",
        tokens: { input: 1000, output: 200 },
        cost: 0.01,
      }),
    );
    fn(dbPath);
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
}

function withEnvDb(dbPath: string, fn: () => void): void {
  const prev = process.env.FAPONY_OPENCODE_DB;
  process.env.FAPONY_OPENCODE_DB = dbPath;
  try {
    fn();
  } finally {
    if (prev === undefined) delete process.env.FAPONY_OPENCODE_DB;
    else process.env.FAPONY_OPENCODE_DB = prev;
  }
}

test("testOpenCodeTimingFromEmbedded", () => {
  withTimingDb((dbPath) =>
    withEnvDb(dbPath, () => {
      const r = readPassiveUsage(undefined, undefined, undefined, true);
      const t = r.detail!.timing!;
      assert.ok(t, "timing present with detail:true");
      // durations: 1000 (embedded) + 2000 (embedded) + 5000 (row fallback) + 0 (step-finish row fallback)
      assert.equal(t.stepSamples, 4);
      assert.equal(t.avgStepMs, (1000 + 2000 + 5000 + 0) / 4);
      assert.equal(t.steps, 1);
      assert.equal(t.avgStepInput, 1000);
      assert.equal(t.avgStepOutput, 200);
      assert.equal(t.avgStepCost, 0.01);
      assert.deepEqual(t.toolLatencyMsByType.read, { count: 1, avgMs: 400 });
      assert.ok(typeof t.note === "string" && t.note.length > 0);
    }),
  );
  console.log("  ✓ opencode detail.timing: embedded + row fallback + latency");
});

test("testOpenCodeTimingNeverLeaksIO", () => {
  withTimingDb((dbPath) =>
    withEnvDb(dbPath, () => {
      const r = readPassiveUsage(undefined, undefined, undefined, true);
      const blob = JSON.stringify(r.detail!.timing);
      assert(!blob.includes("2026-09-09"), "no raw timestamps in timing");
    }),
  );
  console.log("  ✓ opencode timing exposes aggregates only, no raw fields");
});

test("testCollectTimingStepCountMirrorsDetail", () => {
  // A step-finish row without tokens still counts as a step.
  const input = collectTiming([
    { data: '{"type":"step-finish"}', time_created: 1, time_updated: 1 },
  ]);
  assert.equal(input.steps, 1);
  assert.equal(input.stepTokens.length, 1);
  console.log("  ✓ collectTiming counts tokenless step-finish rows");
});

// ─── ZCode integration (no time_updated column) ──────────────────────

function withZcodeTimingDb(fn: (dbPath: string) => void): void {
  const dir = mkdtempSync(join(tmpdir(), "fapony-ztiming-"));
  const dbPath = join(dir, "db.sqlite");
  const db = new Database(dbPath);
  try {
    db.run(
      `CREATE TABLE session (
        id TEXT PRIMARY KEY, project_id TEXT NOT NULL, directory TEXT NOT NULL,
        time_created INTEGER NOT NULL, time_updated INTEGER NOT NULL
      )`,
    );
    db.run(
      `CREATE TABLE model_usage (
        id TEXT PRIMARY KEY, session_id TEXT NOT NULL, model_id TEXT NOT NULL,
        input_tokens INTEGER DEFAULT 0, output_tokens INTEGER DEFAULT 0,
        reasoning_tokens INTEGER DEFAULT 0, cache_creation_input_tokens INTEGER DEFAULT 0,
        cache_read_input_tokens INTEGER DEFAULT 0, computed_total_tokens INTEGER DEFAULT 0
      )`,
    );
    db.run(
      `CREATE TABLE part (
        id TEXT PRIMARY KEY, session_id TEXT NOT NULL, data TEXT NOT NULL, time_created INTEGER NOT NULL
      )`,
    );
    db.prepare(
      `INSERT INTO session (id, project_id, directory, time_created, time_updated) VALUES (?, ?, ?, ?, ?)`,
    ).run("s1", "p1", "/tmp/zwt", 1700000000, 1700000100);
    db.prepare(
      `INSERT INTO model_usage (id, session_id, model_id, input_tokens, output_tokens, reasoning_tokens, cache_creation_input_tokens, cache_read_input_tokens, computed_total_tokens) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run("m1", "s1", "claude-sonnet-5", 1000, 500, 200, 50, 30, 1780);
    db.prepare(
      `INSERT INTO part (id, session_id, data, time_created) VALUES (?, ?, ?, ?)`,
    ).run(
      "p1",
      "s1",
      JSON.stringify({
        type: "tool",
        tool: "Bash",
        time: {
          start: "2026-09-09T03:00:00.000Z",
          end: "2026-09-09T03:00:03.000Z",
        },
        state: {
          time: {
            start: "2026-09-09T03:00:00.000Z",
            end: "2026-09-09T03:00:02.000Z",
          },
        },
      }),
      1700000050,
    );
    db.prepare(
      `INSERT INTO part (id, session_id, data, time_created) VALUES (?, ?, ?, ?)`,
    ).run(
      "p2",
      "s1",
      JSON.stringify({
        type: "step-finish",
        tokens: { input: 500, output: 100 },
        cost: 0,
      }),
      1700000060,
    );
    fn(dbPath);
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
}

test("testZcodeTimingEmbeddedOnly", () => {
  withZcodeTimingDb((dbPath) => {
    const orig = process.env.FAPONY_ZCODE_DB;
    process.env.FAPONY_ZCODE_DB = dbPath;
    try {
      const r = readZcodeUsage(undefined, undefined, undefined, true);
      const t = r.detail!.timing!;
      assert.ok(t, "zcode timing present");
      // Only the tool part has embedded time (3s); step-finish has no
      // time_updated column to fall back to → single sample.
      assert.equal(t.stepSamples, 1);
      assert.equal(t.avgStepMs, 3000);
      assert.equal(t.steps, 1);
      assert.equal(t.avgStepInput, 500);
      assert.deepEqual(t.toolLatencyMsByType.Bash, { count: 1, avgMs: 2000 });
    } finally {
      if (orig === undefined) delete process.env.FAPONY_ZCODE_DB;
      else process.env.FAPONY_ZCODE_DB = orig;
    }
  });
  console.log("  ✓ zcode detail.timing works without time_updated column");
});

// ─── Claude Code integration ─────────────────────────────────────────

function withClaudeTimingFixture(fn: (dir: string) => void): void {
  const dir = mkdtempSync(join(tmpdir(), "fapony-cc-timing-"));
  const projectDir = join(dir, "projects", "-tmp-timing-wt");
  mkdirSync(projectDir, { recursive: true });
  const session = [
    JSON.stringify({
      message: {
        model: "claude-sonnet-5",
        content: [{ type: "tool_use", id: "tu1", name: "Read" }],
        usage: { input_tokens: 1000, output_tokens: 200 },
      },
      timestamp: "2026-09-09T03:00:00.000Z",
    }),
    JSON.stringify({
      message: {
        content: [{ type: "tool_result", tool_use_id: "tu1" }],
      },
      timestamp: "2026-09-09T03:00:01.500Z",
    }),
    JSON.stringify({
      message: {
        model: "claude-sonnet-5",
        content: [{ type: "text", text: "done" }],
        usage: { input_tokens: 2000, output_tokens: 400 },
      },
      timestamp: "2026-09-09T03:01:00.000Z",
    }),
  ].join("\n");
  writeFileSync(join(projectDir, "session-1.jsonl"), session);
  try {
    fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test("testClaudeCodeTimingDetail", () => {
  withClaudeTimingFixture((dir) => {
    const orig = process.env.FAPONY_CLAUDE_PROJECTS_DIR;
    process.env.FAPONY_CLAUDE_PROJECTS_DIR = join(dir, "projects");
    try {
      const plain = readClaudeCodeUsage("/tmp/timing-wt");
      assert.equal(plain.detail, undefined, "default has no detail");
      const r = readClaudeCodeUsage(
        "/tmp/timing-wt",
        undefined,
        undefined,
        true,
      );
      assert.ok(r.detail, "detail:true includes detail");
      assert.deepEqual(r.detail.tool_breakdown, { Read: 1 });
      assert.equal(r.detail.steps, 2);
      assert.equal(r.detail.by_session.length, 1);
      assert.equal(r.detail.by_session[0].steps, 2);
      const t = r.detail.timing!;
      assert.ok(t, "timing present");
      // Turn gap 60s; tool latency 1.5s; per-turn token avgs (never sums).
      assert.equal(t.avgStepMs, 60000);
      assert.equal(t.stepSamples, 1);
      assert.equal(t.avgStepInput, 1500);
      assert.equal(t.avgStepOutput, 300);
      assert.deepEqual(t.toolLatencyMsByType.Read, { count: 1, avgMs: 1500 });
      const blob = JSON.stringify(r.detail);
      assert(!blob.includes("3000"), "no summed input tokens");
    } finally {
      if (orig === undefined) delete process.env.FAPONY_CLAUDE_PROJECTS_DIR;
      else process.env.FAPONY_CLAUDE_PROJECTS_DIR = orig;
    }
  });
  console.log("  ✓ claude-code detail: turn gaps + tool_use latency + avgs");
});
