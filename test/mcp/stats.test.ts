// test/mcp/stats.test.ts — tests for fapony_stats MCP tool

import assert from "node:assert";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  addEvent,
  type Config,
  loadConfig,
  newRun,
  openDb,
  setStatus,
} from "../../src/db/index.js";
import { toolFaponyStats } from "../../src/mcp/tools/stats.js";
import { cmdStats } from "../../src/stats/index.js";

function withTempDb(fn: () => void): void {
  const oldEnv = process.env.FAPONY_STATE_DIR;
  const tmpDir = mkdtempSync(join(tmpdir(), "fapony-mcp-stats-"));
  process.env.FAPONY_STATE_DIR = tmpDir;
  try {
    fn();
  } finally {
    if (oldEnv !== undefined) {
      process.env.FAPONY_STATE_DIR = oldEnv;
    } else {
      delete process.env.FAPONY_STATE_DIR;
    }
  }
}

function _baseConfig(): Config {
  return loadConfig("/nonexistent-path/fapony.config.json");
}

export function testStatsToolEmptyDb(): void {
  withTempDb(() => {
    const result = toolFaponyStats({});
    assert.equal(result.isError, undefined);
    // text mode = raw CLI text, not JSON-wrapped
    assert.equal(result.content[0].text, "no runs yet");
  });
  console.log("  ✓ fapony_stats returns 'no runs yet' for empty db");
}

export function testStatsToolJsonMode(): void {
  withTempDb(() => {
    const db = openDb();
    const runId = newRun(db, "wt1", null, null, "abc");
    addEvent(db, runId, "spawn", { role: "executor", model: "m" });
    addEvent(db, runId, "route", {});
    addEvent(db, runId, "gate", { verdict: "pass-good", note: "", round: 0 });
    setStatus(db, runId, "passed");

    const result = toolFaponyStats({ json: true });
    assert.equal(result.isError, undefined);
    const text = result.content[0].text;
    const data = JSON.parse(text);
    // Must parse back to StatsData shape — pure JSON, no prefix/suffix
    assert.equal(typeof data.runs.total, "number");
    assert.equal(typeof data.runs.passRate, "number");
    assert.ok(Array.isArray(data.byModel));
    assert.ok(Array.isArray(data.byGrade));
    assert.ok(Array.isArray(data.byWorktree));
  });
  console.log("  ✓ fapony_stats json:true returns parseable StatsData");
}

export function testStatsToolTextMode(): void {
  withTempDb(() => {
    const db = openDb();
    const runId = newRun(db, "wt1", null, null, "abc");
    addEvent(db, runId, "gate", { verdict: "pass-good", note: "", round: 0 });
    setStatus(db, runId, "passed");

    const result = toolFaponyStats({ json: false });
    assert.equal(result.isError, undefined);
    const text = result.content[0].text;
    // raw text, not a JSON envelope
    assert.ok(text.includes("runs: 1"), "text mode is raw CLI text");
    assert.ok(text.includes("scope:"), "text mode includes scope line");
    assert.ok(text.includes("pass rate:"));
    assert.ok(text.includes("by grade:"));
    assert.ok(text.includes("pass-good"));
  });
  console.log("  ✓ fapony_stats json:false returns raw CLI-format text");
}

export function testStatsTextMatchesCli(): void {
  withTempDb(() => {
    // Both renders must see the SAME usage numbers. Passive readers scan live
    // session logs, which a running agent is writing to *while this test runs*,
    // so an unpinned comparison drifts between the two calls and fails at
    // random. Point every client reader at a path that does not exist: the
    // usage section is then empty for both, and the test measures what it
    // claims to — one formatter, two entry points.
    const envKeys = [
      "FAPONY_OPENCODE_DB",
      "FAPONY_ZCODE_DB",
      "FAPONY_CLAUDE_PROJECTS_DIR",
      "FAPONY_CODEX_SESSIONS_DIR",
    ];
    const saved = envKeys.map((k) => [k, process.env[k]] as const);
    for (const k of envKeys) process.env[k] = "/nonexistent/fapony-test";
    try {
      const db = openDb();
      const runId = newRun(db, "wt1", null, null, "abc");
      addEvent(db, runId, "spawn", { role: "executor", model: "m" });
      addEvent(db, runId, "route", {});
      addEvent(db, runId, "gate", { verdict: "pass-good", note: "", round: 0 });
      setStatus(db, runId, "passed");

      // Capture CLI output (--all to match MCP's default of all-projects)
      const origLog = console.log;
      const captured: string[] = [];
      console.log = (...a: unknown[]) => {
        captured.push(a.join(" "));
      };
      try {
        cmdStats(["--all"]);
      } finally {
        console.log = origLog;
      }
      const cliText = captured.join("\n");
      // MCP without worktree → all projects, same as CLI --all.
      const mcpText = toolFaponyStats({}).content[0].text;

      // SPEC-verdict-stats: "text เดียวกับ fapony stats — ใช้ formatter ตัวเดียวกัน"
      assert.equal(
        mcpText,
        cliText,
        "MCP text mode must equal CLI output byte-for-byte",
      );
    } finally {
      for (const [k, v] of saved) {
        if (v === undefined) delete process.env[k];
        else process.env[k] = v;
      }
    }
  });
  console.log("  ✓ fapony_stats text mode === fapony stats CLI output");
}

export function testStatsToolByGradeSeparation(): void {
  withTempDb(() => {
    const db = openDb();
    const r1 = newRun(db, "wt1", null, null, "abc");
    const r2 = newRun(db, "wt1", null, null, "abc");
    addEvent(db, r1, "gate", { verdict: "pass-good", note: "", round: 0 });
    setStatus(db, r1, "passed");
    addEvent(db, r2, "gate", { verdict: "fail", note: "", round: 0 });
    setStatus(db, r2, "fixing");

    const result = toolFaponyStats({ json: true });
    const data = JSON.parse(result.content[0].text);
    const grades = data.byGrade.map((g: { grade: string }) => g.grade);
    assert.ok(grades.includes("pass-good"), "should have pass-good");
    assert.ok(grades.includes("fail"), "should have fail");
    assert.notEqual(
      grades.indexOf("pass-good"),
      grades.indexOf("fail"),
      "grades should be separate",
    );
  });
  console.log("  ✓ fapony_stats separates grades in byGrade");
}

export function testStatsToolGroupByReasonCode(): void {
  withTempDb(() => {
    const db = openDb();
    const r1 = newRun(db, "wt1", "plan-a", null, "abc");
    const r2 = newRun(db, "wt1", "plan-a", null, "abc");
    addEvent(db, r1, "gate", {
      verdict: "fail",
      reason_code: "scope_mismatch",
      note: "",
      round: 0,
    });
    addEvent(db, r2, "gate", {
      verdict: "fail",
      reason_code: "scope_mismatch",
      note: "",
      round: 0,
    });
    addEvent(db, r2, "gate", {
      verdict: "fail",
      reason_code: "missing_test",
      note: "",
      round: 1,
    });

    const result = toolFaponyStats({ group_by: "reason_code" });
    assert.equal(result.isError, undefined);
    const data = JSON.parse(result.content[0].text);
    assert.equal(data.group_by, "reason_code");
    assert.equal(data.rows[0].reason, "scope_mismatch");
    assert.equal(data.rows[0].count, 2);
    assert.equal(data.rows[1].reason, "missing_test");

    // top-N cap
    const capped = JSON.parse(
      toolFaponyStats({ group_by: "reason_code", top: 1 }).content[0].text,
    );
    assert.equal(capped.rows.length, 1);

    // worktree scope
    const scoped = JSON.parse(
      toolFaponyStats({ group_by: "reason_code", worktree: "wt-other" })
        .content[0].text,
    );
    assert.deepEqual(scoped.rows, []);
  });
  console.log("  ✓ fapony_stats group_by=reason_code returns top-N counts");
}

export function testStatsToolGroupByPlan(): void {
  withTempDb(() => {
    const db = openDb();
    const r1 = newRun(db, "wt1", "plan-a", null, "abc");
    newRun(db, "wt1", "plan-a", null, "abc");
    setStatus(db, r1, "passed");

    const result = toolFaponyStats({ group_by: "plan" });
    assert.equal(result.isError, undefined);
    const data = JSON.parse(result.content[0].text);
    assert.equal(data.group_by, "plan");
    const row = data.rows.find((r: { plan: string }) => r.plan === "plan-a");
    assert(row, "plan-a present");
    assert.equal(row.runs, 2);
    assert.equal(row.passed, 1);
  });
  console.log("  ✓ fapony_stats group_by=plan returns per-plan totals");
}

export function testStatsToolGroupByPlanWorktreeScoped(): void {
  withTempDb(() => {
    const db = openDb();
    // plan-a spans 2 worktrees: 1 run in wt1, 1 in wt2
    const r1 = newRun(db, "wt1", "plan-a", null, "abc");
    const r2 = newRun(db, "wt2", "plan-a", null, "abc");
    setStatus(db, r1, "passed");
    setStatus(db, r2, "passed");

    // Global: plan-a has 2 runs
    const global = JSON.parse(
      toolFaponyStats({ group_by: "plan" }).content[0].text,
    );
    const gRow = global.rows.find((r: { plan: string }) => r.plan === "plan-a");
    assert.equal(gRow.runs, 2, "global count is 2");

    // Scoped to wt1: plan-a should have 1 run
    const scoped = JSON.parse(
      toolFaponyStats({ group_by: "plan", worktree: "wt1" }).content[0].text,
    );
    const sRow = scoped.rows.find((r: { plan: string }) => r.plan === "plan-a");
    assert.equal(sRow.runs, 1, "scoped count is 1");
    assert.equal(sRow.passed, 1);

    // Scoped to nonexistent worktree: empty
    const empty = JSON.parse(
      toolFaponyStats({ group_by: "plan", worktree: "wt-none" }).content[0]
        .text,
    );
    assert.deepEqual(empty.rows, []);
  });
  console.log("  ✓ fapony_stats group_by=plan worktree returns scoped counts");
}

export function testStatsToolGroupByInvalid(): void {
  withTempDb(() => {
    const result = toolFaponyStats({ group_by: "bogus" });
    assert.equal(result.isError, true);
    assert.ok(result.content[0].text.includes("group_by"));
  });
  console.log("  ✓ fapony_stats rejects unknown group_by");
}

export function testStatsToolModeVerdict(): void {
  withTempDb(() => {
    // Empty db: same "no runs yet" text as the default view.
    const empty = toolFaponyStats({ mode: "verdict" });
    assert.equal(empty.isError, undefined);
    assert.equal(empty.content[0].text, "no runs yet");

    // Non-empty: dispatch must match calling formatVerdictText directly —
    // this is what was missing before the schema exposed `mode`/`regime`:
    // the formatter existed and was CLI-reachable, but no MCP client could
    // ever pass `mode` because the tool's inputSchema didn't declare it.
    const db = openDb();
    const runId = newRun(db, "wt1", null, null, "abc");
    addEvent(db, runId, "spawn", { role: "executor", model: "m" });
    addEvent(db, runId, "route", {});
    addEvent(db, runId, "gate", {
      verdict: "pass-good",
      note: "",
      round: 0,
      regime: "code",
    });
    setStatus(db, runId, "passed");

    const viaTool = toolFaponyStats({ mode: "verdict", regime: "code" })
      .content[0].text;
    assert.ok(
      viaTool.includes("regime=code"),
      "should render the code regime frontier",
    );
    assert.ok(
      !viaTool.includes("{"),
      "verdict mode is text, never JSON-wrapped",
    );
  });
  console.log("  ✓ fapony_stats mode=verdict dispatches to formatVerdictText");
}
