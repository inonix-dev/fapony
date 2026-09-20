// test/stats.test.ts — tests for getStatsData enrichment

import { Database } from "bun:sqlite";
import assert from "node:assert";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  addEvent,
  incrementRound,
  newRun,
  setStatus,
} from "../src/db/index.js";
import { EMPTY_RESULT } from "../src/session/index.js";
import {
  countPendingPlans,
  formatStatsText,
  formatVerdictText,
  getStatsData,
} from "../src/stats/index.js";
import { withTmpDb } from "./helpers.js";

export function testStatsEmptyDb(): void {
  withTmpDb(() => {
    const data = getStatsData();
    assert.equal(data.runs.total, 0);
    assert.deepEqual(data.byModel, []);
    assert.deepEqual(data.byGrade, []);
    assert.deepEqual(data.byWorktree, []);
  });
  console.log("  ✓ getStatsData returns empty for no runs");
}

export function testStatsMultiRoundSeparateGates(): void {
  withTmpDb((db) => {
    const runId = newRun(db, "wt1", null, null, "abc");

    // Round 1: spawn(model-a) → gate(fail). Round 2: spawn(model-b) → gate(pass).
    // Round 3: gate with no spawn in its window → model unknown, still counted.
    addEvent(db, runId, "spawn", { role: "executor", model: "model-a" });
    addEvent(db, runId, "gate", { verdict: "fail", note: "", round: 0 });
    addEvent(db, runId, "spawn", { role: "executor", model: "model-b" });
    addEvent(db, runId, "gate", { verdict: "pass-good", note: "", round: 1 });
    addEvent(db, runId, "gate", { verdict: "pass-good", note: "", round: 2 });
    setStatus(db, runId, "passed");

    const data = getStatsData();
    assert.equal(data.byGrade.length, 2, "2 different grades");
    assert.equal(
      data.byGrade.find((g) => g.grade === "pass-good")?.count,
      2,
      "gate with an empty spawn window is still counted",
    );
    // Each gate sees only its own round's spawn — never the cumulative set.
    const models = data.byModel.map((m) => m.model).sort();
    assert.deepEqual(models, ["model-a", "model-b", "—"]);
    for (const m of data.byModel) assert.equal(m.gateCount, 1);
  });
  console.log("  ✓ getStatsData: per-round gate windows never overlap");
}

export function testStatsLegacyPassMergedWithPassAdequate(): void {
  withTmpDb((db) => {
    const runId1 = newRun(db, "wt1", null, null, "abc");
    const runId2 = newRun(db, "wt1", null, null, "abc");

    // run with legacy "pass"
    addEvent(db, runId1, "gate", { verdict: "pass", note: "", round: 0 });
    setStatus(db, runId1, "passed");

    // run with "pass-adequate"
    addEvent(db, runId2, "gate", {
      verdict: "pass-adequate",
      note: "",
      round: 0,
    });
    setStatus(db, runId2, "passed");

    const data = getStatsData();
    // Should be separate entries, NOT merged
    const legacyPass = data.byGrade.find((g) => g.grade === "pass");
    const passAdequate = data.byGrade.find((g) => g.grade === "pass-adequate");
    assert(legacyPass, "should have legacy pass grade");
    assert(passAdequate, "should have pass-adequate grade");
    assert.equal(legacyPass.count, 1);
    assert.equal(passAdequate.count, 1);
  });
  console.log("  ✓ getStatsData: legacy 'pass' separate from 'pass-adequate'");
}

export function testStatsByWorktree(): void {
  withTmpDb((db) => {
    const r1 = newRun(db, "wt-a", null, null, "abc");
    const r2 = newRun(db, "wt-a", null, null, "abc");
    const r3 = newRun(db, "wt-b", null, null, "abc");

    setStatus(db, r1, "passed");
    setStatus(db, r2, "stalled");
    setStatus(db, r3, "passed");

    const data = getStatsData();
    assert.equal(data.byWorktree.length, 2);
    const a = data.byWorktree.find((w) => w.worktree === "wt-a");
    const b = data.byWorktree.find((w) => w.worktree === "wt-b");
    assert(a && b);
    assert.equal(a.runs, 2);
    assert.equal(a.passed, 1);
    assert.equal(a.stalled, 1);
    assert.equal(b.runs, 1);
    assert.equal(b.passed, 1);
  });
  console.log("  ✓ getStatsData: byWorktree counts correct");
}

export function testStatsModelFromExecutorSpawn(): void {
  withTmpDb((db) => {
    const runId = newRun(db, "wt1", null, null, "abc");

    addEvent(db, runId, "spawn", { role: "executor", model: "mimo-v2" });
    // Gate spawn (different role) — must not win attribution
    addEvent(db, runId, "spawn", { role: "gate", model: "other-model" });

    addEvent(db, runId, "route", {});
    addEvent(db, runId, "gate", { verdict: "pass-good", note: "", round: 0 });
    setStatus(db, runId, "passed");

    const data = getStatsData();
    // Model should be from executor, not gate
    assert.equal(data.byModel.length, 1);
    assert.equal(data.byModel[0].model, "mimo-v2");
  });
  console.log("  ✓ getStatsData: model attribution from executor spawn");
}

export function testStatsModelFromSessionIdWhenNoSpawn(): void {
  withTmpDb((db) => {
    const runId = newRun(db, "wt1", null, null, "abc");

    // No spawn events — gate has session_id only
    addEvent(db, runId, "gate", {
      verdict: "pass-good",
      note: "",
      round: 0,
      session_id: "sess-opencode",
      reason_code: "missing_test",
      source: "mcp",
    });
    setStatus(db, runId, "passed");

    // Point OpenCode DB at a fixture that has this session
    const dir = mkdtempSync(join(tmpdir(), "fapony-stats-gates-"));
    const dbPath = join(dir, "opencode.db");
    const ocdb = new Database(dbPath);
    ocdb.run(
      `CREATE TABLE project (id TEXT PRIMARY KEY, worktree TEXT NOT NULL)`,
    );
    ocdb.run(
      `CREATE TABLE session (id TEXT PRIMARY KEY, project_id TEXT NOT NULL, model TEXT, time_created INTEGER NOT NULL, tokens_input INTEGER DEFAULT 0, tokens_output INTEGER DEFAULT 0, tokens_cache_read INTEGER DEFAULT 0, tokens_cache_write INTEGER DEFAULT 0, cost REAL DEFAULT 0)`,
    );
    ocdb.run(
      `CREATE TABLE part (id TEXT PRIMARY KEY, message_id TEXT NOT NULL, session_id TEXT NOT NULL, time_created INTEGER NOT NULL, time_updated INTEGER NOT NULL, data TEXT NOT NULL)`,
    );
    ocdb
      .prepare(`INSERT INTO project (id, worktree) VALUES (?, ?)`)
      .run("p1", "/tmp/wt1");
    ocdb
      .prepare(
        `INSERT INTO session (id, project_id, model, time_created) VALUES (?, ?, ?, ?)`,
      )
      .run(
        "sess-opencode",
        "p1",
        '{"providerID":"anthropic","id":"claude-sonnet-5"}',
        1000,
      );
    ocdb.close();

    const prev = process.env.FAPONY_OPENCODE_DB;
    try {
      process.env.FAPONY_OPENCODE_DB = dbPath;
      const data = getStatsData();
      assert.equal(data.byModel.length, 1);
      assert.equal(data.byModel[0].model, "claude-sonnet-5");
    } finally {
      if (prev === undefined) delete process.env.FAPONY_OPENCODE_DB;
      else process.env.FAPONY_OPENCODE_DB = prev;
      rmSync(dir, { recursive: true, force: true });
    }
  });
  console.log(
    "  ✓ getStatsData: model from session_id when no spawn in window",
  );
}

export function testStatsByModelGroupsByClientProviderAgent(): void {
  withTmpDb((db) => {
    const runId = newRun(db, "wt1", null, null, "abc");

    // Same model name on two providers — must land in two different buckets
    addEvent(db, runId, "gate", {
      verdict: "pass-good",
      note: "",
      round: 0,
      session_id: "sess-zcode-1",
      reason_code: "missing_test",
      source: "mcp",
    });
    addEvent(db, runId, "gate", {
      verdict: "pass-good",
      note: "",
      round: 1,
      session_id: "sess-oc-1",
      reason_code: "missing_test",
      source: "mcp",
    });
    setStatus(db, runId, "passed");

    const dir = mkdtempSync(join(tmpdir(), "fapony-stats-gates-split-"));
    const zcPath = join(dir, "zcode.sqlite");
    const zdb = new Database(zcPath);
    zdb.run(
      `CREATE TABLE model_usage (
        id TEXT PRIMARY KEY, session_id TEXT NOT NULL, model_id TEXT NOT NULL,
        provider_id TEXT, agent TEXT,
        input_tokens INTEGER DEFAULT 0, output_tokens INTEGER DEFAULT 0,
        cache_read_input_tokens INTEGER DEFAULT 0,
        cache_creation_input_tokens INTEGER DEFAULT 0,
        computed_total_tokens INTEGER NOT NULL DEFAULT 0
      )`,
    );
    zdb
      .prepare(
        `INSERT INTO model_usage (id, session_id, model_id, provider_id, agent, computed_total_tokens) VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(
        "m1",
        "sess-zcode-1",
        "GLM-5.3-Flash",
        "builtin:zai-start-plan",
        "zcode-Explore",
        5000,
      );
    zdb.close();

    const ocPath = join(dir, "opencode.db");
    const ocdb = new Database(ocPath);
    ocdb.run(
      `CREATE TABLE session (id TEXT PRIMARY KEY, project_id TEXT NOT NULL, model TEXT, tokens_input INTEGER DEFAULT 0, tokens_output INTEGER DEFAULT 0, tokens_cache_read INTEGER DEFAULT 0, tokens_cache_write INTEGER DEFAULT 0)`,
    );
    ocdb
      .prepare(`INSERT INTO session (id, project_id, model) VALUES (?, ?, ?)`)
      .run(
        "sess-oc-1",
        "p1",
        '{"providerID":"other-provider","id":"GLM-5.3-Flash"}',
      );
    ocdb.close();

    const prevOC = process.env.FAPONY_OPENCODE_DB;
    const prevZC = process.env.FAPONY_ZCODE_DB;
    try {
      process.env.FAPONY_OPENCODE_DB = ocPath;
      process.env.FAPONY_ZCODE_DB = zcPath;
      const data = getStatsData();
      assert.equal(data.byModel.length, 2, "same name ≠ same bucket");
      const zc = data.byModel.find((m) => m.client === "zcode")!;
      const oc = data.byModel.find((m) => m.client === "opencode")!;
      assert.ok(zc && oc);
      assert.equal(zc.provider, "builtin:zai-start-plan");
      assert.equal(zc.model, "GLM-5.3-Flash");
      assert.equal(zc.agent, "zcode-Explore");
      assert.equal(oc.provider, "other-provider");
      assert.equal(oc.model, "GLM-5.3-Flash");
      assert.equal(oc.agent, "—");
    } finally {
      if (prevOC === undefined) delete process.env.FAPONY_OPENCODE_DB;
      else process.env.FAPONY_OPENCODE_DB = prevOC;
      if (prevZC === undefined) delete process.env.FAPONY_ZCODE_DB;
      else process.env.FAPONY_ZCODE_DB = prevZC;
      rmSync(dir, { recursive: true, force: true });
    }
  });
  console.log("  ✓ getStatsData: byModel splits same model across providers");
}

export function testStatsSpawnModelWinsOverSessionId(): void {
  withTmpDb((db) => {
    const runId = newRun(db, "wt1", null, null, "abc");

    // Executor spawn with model — gate also has session_id pointing elsewhere
    addEvent(db, runId, "spawn", { role: "executor", model: "mimo-v2" });

    addEvent(db, runId, "route", {});
    addEvent(db, runId, "gate", {
      verdict: "pass-good",
      note: "",
      round: 0,
      session_id: "sess-other",
      reason_code: "missing_test",
      source: "mcp",
    });
    setStatus(db, runId, "passed");

    // OpenCode DB with a *different* model for session_id
    const dir = mkdtempSync(join(tmpdir(), "fapony-stats-gates-"));
    const dbPath = join(dir, "opencode.db");
    const ocdb = new Database(dbPath);
    ocdb.run(
      `CREATE TABLE project (id TEXT PRIMARY KEY, worktree TEXT NOT NULL)`,
    );
    ocdb.run(
      `CREATE TABLE session (id TEXT PRIMARY KEY, project_id TEXT NOT NULL, model TEXT, time_created INTEGER NOT NULL, tokens_input INTEGER DEFAULT 0, tokens_output INTEGER DEFAULT 0, tokens_cache_read INTEGER DEFAULT 0, tokens_cache_write INTEGER DEFAULT 0, cost REAL DEFAULT 0)`,
    );
    ocdb.run(
      `CREATE TABLE part (id TEXT PRIMARY KEY, message_id TEXT NOT NULL, session_id TEXT NOT NULL, time_created INTEGER NOT NULL, time_updated INTEGER NOT NULL, data TEXT NOT NULL)`,
    );
    ocdb
      .prepare(`INSERT INTO project (id, worktree) VALUES (?, ?)`)
      .run("p1", "/tmp/wt1");
    ocdb
      .prepare(
        `INSERT INTO session (id, project_id, model, time_created) VALUES (?, ?, ?, ?)`,
      )
      .run(
        "sess-other",
        "p1",
        '{"providerID":"anthropic","id":"claude-opus-5"}',
        1000,
      );
    ocdb.close();

    const prev = process.env.FAPONY_OPENCODE_DB;
    try {
      process.env.FAPONY_OPENCODE_DB = dbPath;
      const data = getStatsData();
      assert.equal(data.byModel.length, 1);
      // Spawn model wins — session_id is fallback only
      assert.equal(data.byModel[0].model, "mimo-v2");
    } finally {
      if (prev === undefined) delete process.env.FAPONY_OPENCODE_DB;
      else process.env.FAPONY_OPENCODE_DB = prev;
      rmSync(dir, { recursive: true, force: true });
    }
  });
  console.log("  ✓ getStatsData: spawn model wins over session_id fallback");
}

// --- Cross-run knowledge (PLAN-project-health-context §2) ---

export function testStatsReasonCodeBreakdown(): void {
  withTmpDb((db) => {
    const r1 = newRun(db, "wt1", "plan-a", null, "abc");
    const r2 = newRun(db, "wt1", "plan-a", null, "abc");
    const r3 = newRun(db, "wt2", "plan-b", null, "abc");
    const r4 = newRun(db, "wt1", "plan-a", null, "abc");

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
    // pass gate carrying a reason_code must NOT count
    addEvent(db, r3, "gate", {
      verdict: "pass-good",
      reason_code: "scope_mismatch",
      note: "",
      round: 0,
    });
    // legacy shape: no reason_code field, [code] note prefix fallback
    addEvent(db, r4, "gate", {
      verdict: "fail",
      note: "[spec_gap] underspecified",
      round: 0,
    });

    const data = getStatsData();
    assert.equal(data.byReasonCode[0].worktree, "wt1");
    assert.equal(data.byReasonCode[0].reason, "scope_mismatch");
    assert.equal(data.byReasonCode[0].count, 2);
    const spec = data.byReasonCode.find((r) => r.reason === "spec_gap");
    assert(spec && spec.count === 1, "note-prefix fallback counts");
    assert(
      !data.byReasonCode.some((r) => r.worktree === "wt2"),
      "pass gates excluded",
    );
  });
  console.log(
    "  ✓ getStatsData: byReasonCode counts non-pass gates per worktree",
  );
}

export function testStatsEscalatedRuns(): void {
  withTmpDb((db) => {
    const r1 = newRun(db, "wt1", "plan-a", null, "abc");
    incrementRound(db, r1);
    incrementRound(db, r1);
    incrementRound(db, r1); // round 3 > default maxRounds 2
    const r2 = newRun(db, "wt1", "plan-b", null, "abc");
    incrementRound(db, r2); // round 1 — not escalated

    const data = getStatsData();
    assert.equal(data.escalatedRuns.length, 1);
    assert.equal(data.escalatedRuns[0].id, r1);
    assert.equal(data.escalatedRuns[0].plan, "plan-a");
    assert.equal(data.escalatedRuns[0].round, 3);
  });
  console.log("  ✓ getStatsData: escalatedRuns lists round > maxRounds");
}

export function testStatsPlanBreakdown(): void {
  withTmpDb((db) => {
    const r1 = newRun(db, "wt1", "plan-a", null, "abc");
    newRun(db, "wt2", "plan-a", null, "abc");
    const r3 = newRun(db, "wt1", "plan-b", null, "abc");
    setStatus(db, r1, "passed");
    incrementRound(db, r3);
    incrementRound(db, r3);
    incrementRound(db, r3); // plan-b escalated

    const data = getStatsData();
    const a = data.byPlan.find((p) => p.plan === "plan-a");
    const b = data.byPlan.find((p) => p.plan === "plan-b");
    assert(a && b);
    assert.equal(a.runs, 2);
    assert.equal(a.passed, 1);
    assert.equal(a.escalated, 0);
    assert.deepEqual(a.worktrees, ["wt1", "wt2"]);
    assert.equal(b.escalated, 1);
  });
  console.log("  ✓ getStatsData: byPlan totals runs/passed/escalated");
}

export function testStatsBestPassing(): void {
  withTmpDb((db) => {
    const r1 = newRun(db, "wt1", "good-shape", null, "abc");
    addEvent(db, r1, "gate", { verdict: "pass-good", note: "", round: 0 });
    setStatus(db, r1, "passed");
    // round 2 pass — not a round-1 template
    const r2 = newRun(db, "wt1", "slow-shape", null, "abc");
    incrementRound(db, r2);
    incrementRound(db, r2);
    addEvent(db, r2, "gate", { verdict: "pass-good", note: "", round: 2 });
    // null plan — excluded even with round-1 pass
    const r3 = newRun(db, "wt1", null, null, "abc");
    addEvent(db, r3, "gate", { verdict: "pass-good", note: "", round: 0 });

    const data = getStatsData();
    assert.equal(data.bestPassing.length, 1);
    assert.equal(data.bestPassing[0].plan, "good-shape");
    assert.equal(data.bestPassing[0].worktree, "wt1");
  });
  console.log("  ✓ getStatsData: bestPassing only round-1 passes with a plan");
}

export function testCountPendingPlans(): void {
  const dir = mkdtempSync(join(tmpdir(), "fapony-pending-"));
  try {
    // No fapony.config.json → falls back to the .fapony/plan scaffold default.
    mkdirSync(join(dir, ".fapony/plan/done"), { recursive: true });
    writeFileSync(join(dir, ".fapony/plan/PLAN-a.md"), "");
    writeFileSync(join(dir, ".fapony/plan/PLAN-b.md"), "");
    writeFileSync(join(dir, ".fapony/plan/done/PLAN-old.md"), "");
    writeFileSync(join(dir, ".fapony/plan/notes.txt"), "");
    assert.equal(countPendingPlans(dir), 2);

    // planDir is hardcoded — .fapony/plan is always used.
    // Uncountable → null, never 0 ("no plan dir" must not read as "none pending").
    assert.equal(countPendingPlans(join(dir, "nope")), null);
    assert.equal(countPendingPlans("mcp-external"), null);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  console.log("  ✓ countPendingPlans: done/ excluded, null when uncountable");
}

/**
 * Tripwire: getStatsData must collect MORE notes than project_health_context
 * displays. It filters by worktree/files[] before slicing to 3, so a
 * collection cap of 3 here silently hides every file-scoped match older than
 * the three newest gates in the whole DB.
 */
export function testStatsVerdictNotesNotCappedAtDisplayLimit(): void {
  withTmpDb((db) => {
    const runId = newRun(db, "wt1", null, null, "abc");
    for (let i = 0; i < 5; i++) {
      addEvent(db, runId, "gate", {
        verdict: "fail",
        reason_code: "spec_gap",
        note: `[spec_gap] note ${i}`,
        round: i,
      });
    }

    const notes = getStatsData().recentVerdictNotes;
    assert.equal(notes.length, 5, "all notes collected, not capped at 3");
    assert.equal(notes[0].note, "note 4", "newest first, reason_code stripped");
  });
  console.log("  ✓ getStatsData: verdict notes collected past the display cap");
}

export function testStatsByFileRisk(): void {
  withTmpDb((db) => {
    const r1 = newRun(db, "wt1", null, null, "abc");
    addEvent(db, r1, "gate", {
      verdict: "fail",
      reason_code: "spec_gap",
      note: "x",
      files: ["src/auth.ts", "src/ui.ts"],
    });
    const r2 = newRun(db, "wt1", null, null, "abc");
    addEvent(db, r2, "gate", {
      verdict: "pass-good",
      note: "y",
      files: ["src/auth.ts"],
    });
    // Other worktree must not merge into wt1's rows.
    const r3 = newRun(db, "wt2", null, null, "abc");
    addEvent(db, r3, "gate", {
      verdict: "fail",
      reason_code: "wrong_layer",
      note: "z",
      files: ["src/auth.ts"],
    });
    // A gate with no files[] contributes nothing.
    addEvent(db, r2, "gate", { verdict: "fail", note: "no files" });

    const byFile = getStatsData().byFile;
    const auth = byFile.find(
      (f) => f.worktree === "wt1" && f.file === "src/auth.ts",
    );
    assert.ok(auth, "src/auth.ts row missing");
    assert.equal(auth.gates, 2);
    assert.equal(auth.fails, 1);
    assert.equal(auth.lastReason, "spec_gap");

    const other = byFile.find(
      (f) => f.worktree === "wt2" && f.file === "src/auth.ts",
    );
    assert.equal(other?.gates, 1, "worktrees must not merge");

    // Worst-first ordering: 1 fail beats 0 fails.
    const ui = byFile.findIndex((f) => f.file === "src/ui.ts");
    const authIdx = byFile.findIndex(
      (f) => f.worktree === "wt1" && f.file === "src/auth.ts",
    );
    assert.ok(ui < authIdx || byFile[ui].fails >= byFile[authIdx].fails);
  });
  console.log("  ✓ getStatsData byFile counts graded touches vs fails");
}

export function testStatsPassRateFromVerdicts(): void {
  withTmpDb((db) => {
    // Abandoned with no verdict — never judged, must not count either way.
    newRun(db, "wt1", null, null, "abc");
    // fail closed by a pass: the unit of work ended up passing.
    const fixed = newRun(db, "wt1", null, null, "abc");
    addEvent(db, fixed, "gate", { verdict: "fail", note: "x" });
    addEvent(db, fixed, "gate", { verdict: "pass-good", note: "y" });
    // Still failing at its last verdict.
    const broken = newRun(db, "wt1", null, null, "abc");
    addEvent(db, broken, "gate", { verdict: "fail", note: "z" });

    const data = getStatsData();
    assert.equal(data.runs.total, 3);
    // 1 of 2 graded runs passed — the ungraded run is out of the denominator.
    assert.equal(data.runs.passRate, 0.5);
  });
  console.log("  ✓ passRate counts graded runs only, by last verdict");
}

export function testStatsUsageByModelIdentity(): void {
  // Regression: the same model id under two providers used to render as two
  // identical-looking lines, and an all-zero row looked like a parse failure.
  withTmpDb((db) => {
    const runId = newRun(db, "wt1", null, null, "abc");
    addEvent(db, runId, "gate", { verdict: "pass-good", note: "", round: 0 });
    setStatus(db, runId, "passed");

    const data = getStatsData();
    data.usage = {
      ...data.usage,
      session_count: 3,
      by_model: [
        {
          provider: "opencode-go",
          model: "mimo-v2.5",
          session_count: 1,
          tokens_input: 10,
          tokens_output: 2,
          tokens_reasoning: 0,
          tokens_cache_read: 0,
          tokens_cache_write: 0,
          cost: 1,
        },
        {
          provider: "xiaomi",
          model: "mimo-v2.5",
          session_count: 1,
          tokens_input: 0,
          tokens_output: 0,
          tokens_reasoning: 0,
          tokens_cache_read: 0,
          tokens_cache_write: 0,
          cost: 0,
        },
        {
          provider: "mimo",
          model: "",
          session_count: 7,
          tokens_input: 0,
          tokens_output: 0,
          tokens_reasoning: 0,
          tokens_cache_read: 0,
          tokens_cache_write: 0,
          cost: 0,
        },
      ],
    };

    const text = formatStatsText(data);
    assert.ok(
      text.includes("opencode-go/mimo-v2.5: 1 sessions"),
      "provider is part of the model identity",
    );
    assert.ok(
      text.includes("xiaomi/mimo-v2.5: 1 sessions"),
      "same id on another provider is a separate, distinguishable line",
    );
    assert.ok(
      text.includes("mimo/(no model id): 7 sessions"),
      "empty model id is labelled, not blank",
    );
  });
  console.log("  ✓ stats usage by-model: provider + session count in the line");
}

export function testStatsByPlanModeSplit(): void {
  withTmpDb((db) => {
    const r1 = newRun(db, "wt1", "plan-a.md", null, "abc");
    addEvent(db, r1, "gate", {
      verdict: "pass-good",
      note: "",
      round: 0,
      session_id: "sess-oc-1",
      reason_code: "missing_test",
      source: "mcp",
    });
    setStatus(db, r1, "passed");

    // No-plan run
    const r2 = newRun(db, "wt1", null, null, "abc");
    addEvent(db, r2, "gate", {
      verdict: "fail",
      note: "x",
      round: 0,
      session_id: "sess-oc-2",
      reason_code: "spec_gap",
      source: "mcp",
    });

    const data = getStatsData();
    const planned = data.byPlanMode.find(
      (r) => r.hasPlan === true && r.model === "—",
    );
    const noPlan = data.byPlanMode.find(
      (r) => r.hasPlan === false && r.model === "—",
    );
    assert.ok(planned, "planned row must exist");
    assert.ok(noPlan, "no-plan row must exist");
    assert.equal(planned.gates, 1);
    assert.equal(noPlan.gates, 1);
    assert.equal(noPlan.fails, 1);
    assert.equal(planned.fails, 0);
  });
  console.log("  ✓ getStatsData: byPlanMode splits planned vs no-plan");
}

export function testStatsByRegimeSplit(): void {
  withTmpDb((db) => {
    const r1 = newRun(db, "wt1", null, null, "abc");
    addEvent(db, r1, "gate", {
      verdict: "pass-good",
      note: "",
      round: 0,
      regime: "code",
      reason_code: "missing_test",
      source: "mcp",
    });
    setStatus(db, r1, "passed");

    const r2 = newRun(db, "wt1", null, null, "abc");
    addEvent(db, r2, "gate", {
      verdict: "fail",
      note: "x",
      round: 0,
      regime: "fix",
      reason_code: "spec_gap",
      source: "mcp",
    });

    // Old gate with no regime → must sit in "—" row
    const r3 = newRun(db, "wt1", null, null, "abc");
    addEvent(db, r3, "gate", {
      verdict: "pass-good",
      note: "",
      round: 0,
    });

    const data = getStatsData();
    const code = data.byRegime.find(
      (r) => r.regime === "code" && r.model === "—",
    );
    const fix = data.byRegime.find(
      (r) => r.regime === "fix" && r.model === "—",
    );
    const dash = data.byRegime.find((r) => r.regime === "—" && r.model === "—");
    assert.ok(code, "code regime row must exist");
    assert.ok(fix, "fix regime row must exist");
    assert.ok(dash, "— regime row must exist for old gates");
    assert.equal(code.gates, 1);
    assert.equal(code.fails, 0);
    assert.equal(fix.gates, 1);
    assert.equal(fix.fails, 1);
    assert.equal(dash.gates, 1);
    assert.equal(dash.fails, 0);
  });
  console.log(
    "  ✓ getStatsData: byRegime old gates in — row, new gates in labelled rows",
  );
}

export function testStatsTokensInByModel(): void {
  withTmpDb((db) => {
    const runId = newRun(db, "wt1", null, null, "abc");
    addEvent(db, runId, "gate", {
      verdict: "pass-good",
      note: "",
      round: 0,
      session_id: "sess-opencode",
      reason_code: "missing_test",
      source: "mcp",
    });
    setStatus(db, runId, "passed");

    // Set up OpenCode DB with a session that has tokens
    const dir = mkdtempSync(join(tmpdir(), "fapony-stats-tokens-"));
    const dbPath = join(dir, "opencode.db");
    const ocdb = new Database(dbPath);
    ocdb.run(
      `CREATE TABLE project (id TEXT PRIMARY KEY, worktree TEXT NOT NULL)`,
    );
    ocdb.run(
      `CREATE TABLE session (id TEXT PRIMARY KEY, project_id TEXT NOT NULL, model TEXT, time_created INTEGER NOT NULL, tokens_input INTEGER DEFAULT 0, tokens_output INTEGER DEFAULT 0, tokens_cache_read INTEGER DEFAULT 0, tokens_cache_write INTEGER DEFAULT 0, cost REAL DEFAULT 0)`,
    );
    ocdb.run(
      `CREATE TABLE part (id TEXT PRIMARY KEY, message_id TEXT NOT NULL, session_id TEXT NOT NULL, time_created INTEGER NOT NULL, time_updated INTEGER NOT NULL, data TEXT NOT NULL)`,
    );
    ocdb
      .prepare(`INSERT INTO project (id, worktree) VALUES (?, ?)`)
      .run("p1", "/tmp/wt1");
    ocdb
      .prepare(
        `INSERT INTO session (id, project_id, model, time_created, tokens_input, tokens_output) VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run("sess-opencode", "p1", "claude-sonnet-5", 1000, 50000, 12000);
    ocdb.close();

    const prev = process.env.FAPONY_OPENCODE_DB;
    try {
      process.env.FAPONY_OPENCODE_DB = dbPath;
      const data = getStatsData();
      assert.equal(data.byModel.length, 1);
      assert.equal(data.byModel[0].tokensInput, 50000);
      assert.equal(data.byModel[0].tokensOutput, 12000);
    } finally {
      if (prev === undefined) delete process.env.FAPONY_OPENCODE_DB;
      else process.env.FAPONY_OPENCODE_DB = prev;
      rmSync(dir, { recursive: true, force: true });
    }
  });
  console.log("  ✓ getStatsData: tokens carried through to byModel");
}

// --- tokens/pass (PLAN-cost-per-pass) ---

/** OpenCode fixture: one session with tokens, reusable by the cost/pass tests. */
function withOpenCodeSession(
  sessionId: string,
  tokens: {
    input: number;
    output: number;
    cacheRead: number;
    cacheWrite: number;
  },
  fn: () => void,
): void {
  const dir = mkdtempSync(join(tmpdir(), "fapony-stats-perpass-"));
  const dbPath = join(dir, "opencode.db");
  const ocdb = new Database(dbPath);
  ocdb.run(
    `CREATE TABLE project (id TEXT PRIMARY KEY, worktree TEXT NOT NULL)`,
  );
  ocdb.run(
    `CREATE TABLE session (id TEXT PRIMARY KEY, project_id TEXT NOT NULL, model TEXT, time_created INTEGER NOT NULL, tokens_input INTEGER DEFAULT 0, tokens_output INTEGER DEFAULT 0, tokens_cache_read INTEGER DEFAULT 0, tokens_cache_write INTEGER DEFAULT 0, cost REAL DEFAULT 0)`,
  );
  ocdb.run(
    `CREATE TABLE part (id TEXT PRIMARY KEY, message_id TEXT NOT NULL, session_id TEXT NOT NULL, time_created INTEGER NOT NULL, time_updated INTEGER NOT NULL, data TEXT NOT NULL)`,
  );
  ocdb
    .prepare(`INSERT INTO project (id, worktree) VALUES (?, ?)`)
    .run("p1", "/tmp/wt1");
  ocdb
    .prepare(
      `INSERT INTO session (id, project_id, model, time_created, tokens_input, tokens_output, tokens_cache_read, tokens_cache_write) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      sessionId,
      "p1",
      '{"providerID":"anthropic","id":"claude-sonnet-5"}',
      1000,
      tokens.input,
      tokens.output,
      tokens.cacheRead,
      tokens.cacheWrite,
    );
  ocdb.close();
  const prev = process.env.FAPONY_OPENCODE_DB;
  try {
    process.env.FAPONY_OPENCODE_DB = dbPath;
    fn();
  } finally {
    if (prev === undefined) delete process.env.FAPONY_OPENCODE_DB;
    else process.env.FAPONY_OPENCODE_DB = prev;
    rmSync(dir, { recursive: true, force: true });
  }
}

export function testStatsTokensPerPassChargesReworkOnce(): void {
  withTmpDb((db) => {
    // fail→pass in one run, one session: the retry is charged once and divided
    // by the single pass gate — the whole point of the metric.
    const runId = newRun(db, "wt1", null, null, "abc");
    addEvent(db, runId, "gate", {
      verdict: "fail",
      note: "",
      round: 0,
      session_id: "sess-perpass",
      reason_code: "spec_gap",
      source: "mcp",
    });
    addEvent(db, runId, "gate", {
      verdict: "pass-good",
      note: "",
      round: 1,
      session_id: "sess-perpass",
      reason_code: "missing_test",
      source: "mcp",
    });
    setStatus(db, runId, "passed");

    withOpenCodeSession(
      "sess-perpass",
      { input: 50000, output: 12000, cacheRead: 7000, cacheWrite: 3000 },
      () => {
        const data = getStatsData();
        const m = data.byModel[0];
        assert.equal(m.gateCount, 2);
        assert.equal(m.fails, 1);
        assert.equal(m.passes, 1);
        // cache counts as input; charged once despite two gates
        assert.equal(m.tokensInput, 60000);
        assert.equal(m.tokensOutput, 12000);
        assert.equal(m.tokensPerPass, 72000);
        // every bucket carries the pair
        assert.equal(data.byRegime[0].passes, 1);
        assert.equal(data.byRegime[0].tokensPerPass, 72000);
        assert.equal(data.byPlanMode[0].tokensPerPass, 72000);
        assert.ok(
          formatStatsText(data).includes("tokens/pass"),
          "text shows the new column",
        );
      },
    );
  });
  console.log("  ✓ stats tokens/pass: session charged once, divided by passes");
}

export function testStatsTokensPerPassNullWhenNoPass(): void {
  withTmpDb((db) => {
    const runId = newRun(db, "wt1", null, null, "abc");
    // uncertain is not pass-family — a bucket of only non-passes has no divisor.
    addEvent(db, runId, "gate", {
      verdict: "uncertain",
      note: "",
      round: 0,
      session_id: "sess-nopass",
      reason_code: "other",
      source: "mcp",
    });
    addEvent(db, runId, "gate", {
      verdict: "fail",
      note: "",
      round: 1,
      session_id: "sess-nopass",
      reason_code: "spec_gap",
      source: "mcp",
    });

    withOpenCodeSession(
      "sess-nopass",
      { input: 40000, output: 5000, cacheRead: 0, cacheWrite: 0 },
      () => {
        const data = getStatsData();
        const m = data.byModel[0];
        assert.equal(m.passes, 0);
        assert.equal(m.fails, 2, "uncertain counts as a non-pass");
        assert.equal(m.tokensPerPass, null, "no passes → null, never Infinity");
        const text = formatStatsText(data);
        const header = text
          .split("\n")
          .find((l) => l.includes("tokens/pass"))!
          .split("|")
          .map((c) => c.trim());
        const row = text
          .split("\n")
          .find((l) => l.includes("claude-sonnet-5"))!
          .split("|")
          .map((c) => c.trim());
        assert.strictEqual(
          row[header.indexOf("tokens/pass")],
          "—",
          "tokens/pass cell renders as —, not the agent column",
        );
      },
    );
  });
  console.log("  ✓ stats tokens/pass: passes=0 → null (no divide-by-zero)");
}

export function testStatsTokensPerPassNullWithoutTokens(): void {
  withTmpDb((db) => {
    // Spawn-attributed model: pass is known but no session tokens exist.
    const runId = newRun(db, "wt1", null, null, "abc");
    addEvent(db, runId, "spawn", { role: "executor", model: "model-m" });
    addEvent(db, runId, "gate", { verdict: "pass-good", note: "", round: 0 });
    setStatus(db, runId, "passed");

    const data = getStatsData();
    const m = data.byModel.find((x) => x.model === "model-m")!;
    assert.equal(m.passes, 1);
    assert.equal(
      m.tokensPerPass,
      null,
      "no token record → unmeasurable, not 0",
    );
  });
  console.log("  ✓ stats tokens/pass: no tokens → null (unmeasurable ≠ free)");
}

export function testStatsTokensCountSessionOnce(): void {
  withTmpDb((db) => {
    // Two gates, one session — the shape that is normal, not rare: 15 of the
    // 35 sessions behind this project's own gates carry more than one.
    const runId = newRun(db, "wt1", null, null, "abc");
    for (const reason of ["missing_test", "spec_gap"]) {
      addEvent(db, runId, "gate", {
        verdict: "pass-good",
        note: "",
        round: 0,
        session_id: "sess-shared",
        reason_code: reason,
        source: "mcp",
      });
    }
    setStatus(db, runId, "passed");

    const dir = mkdtempSync(join(tmpdir(), "fapony-stats-dedupe-"));
    const dbPath = join(dir, "opencode.db");
    const ocdb = new Database(dbPath);
    ocdb.run(
      `CREATE TABLE project (id TEXT PRIMARY KEY, worktree TEXT NOT NULL)`,
    );
    ocdb.run(
      `CREATE TABLE session (id TEXT PRIMARY KEY, project_id TEXT NOT NULL, model TEXT, time_created INTEGER NOT NULL, tokens_input INTEGER DEFAULT 0, tokens_output INTEGER DEFAULT 0, tokens_cache_read INTEGER DEFAULT 0, tokens_cache_write INTEGER DEFAULT 0, cost REAL DEFAULT 0)`,
    );
    ocdb.run(
      `CREATE TABLE part (id TEXT PRIMARY KEY, message_id TEXT NOT NULL, session_id TEXT NOT NULL, time_created INTEGER NOT NULL, time_updated INTEGER NOT NULL, data TEXT NOT NULL)`,
    );
    ocdb
      .prepare(`INSERT INTO project (id, worktree) VALUES (?, ?)`)
      .run("p1", "/tmp/wt1");
    ocdb
      .prepare(
        `INSERT INTO session (id, project_id, model, time_created, tokens_input, tokens_output, tokens_cache_read, tokens_cache_write) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        "sess-shared",
        "p1",
        "claude-sonnet-5",
        1000,
        50000,
        12000,
        7000,
        3000,
      );
    ocdb.close();

    const prev = process.env.FAPONY_OPENCODE_DB;
    try {
      process.env.FAPONY_OPENCODE_DB = dbPath;
      const data = getStatsData();
      assert.equal(data.byModel[0].gateCount, 2);
      // Charged once, and cache counts as input (50000 + 7000 + 3000).
      assert.equal(data.byModel[0].tokensInput, 60000);
      assert.equal(data.byModel[0].tokensOutput, 12000);
      assert.equal(data.byPlanMode[0].tokensInput, 60000);
      assert.equal(data.byRegime[0].tokensInput, 60000);
    } finally {
      if (prev === undefined) delete process.env.FAPONY_OPENCODE_DB;
      else process.env.FAPONY_OPENCODE_DB = prev;
      rmSync(dir, { recursive: true, force: true });
    }
  });
  console.log(
    "  ✓ getStatsData: a session's tokens are charged once, cache included",
  );
}

// The real Claude Code shape: `input_tokens` holds only the uncached remainder,
// so printing it alone showed 750k in / 64.6M out — a coding agent reading less
// than it wrote, which cannot happen. Cache read/write are input and must be in
// the total; they stay separate in the data because they bill at other rates.
export function testStatsUsageCountsCacheAsInput(): void {
  withTmpDb((db) => {
    const runId = newRun(db, "wt1", null, null, "abc");
    addEvent(db, runId, "gate", { verdict: "pass-good", note: "", round: 0 });
    setStatus(db, runId, "passed");

    const data = getStatsData();
    data.claudeCodeUsage = {
      ...EMPTY_RESULT,
      total_tokens_input: 750_000,
      total_tokens_output: 64_000_000,
      total_tokens_cache_read: 12_000_000_000,
      total_tokens_cache_write: 900_000_000,
      session_count: 827,
      by_model: [
        {
          provider: "anthropic",
          model: "claude-opus-5",
          session_count: 218,
          tokens_input: 164_722,
          tokens_output: 16_860_080,
          tokens_reasoning: 0,
          tokens_cache_read: 2_135_000_000,
          tokens_cache_write: 663_473,
          cost: 0,
        },
      ],
    };

    const text = formatStatsText(data);
    assert.ok(
      text.includes("12,900,750,000 in (12,900,000,000 cached)"),
      "total input = input + cache read + cache write, with the cached part shown",
    );
    assert.ok(
      text.includes("2,135,828,195 in (2,135,663,473 cached)"),
      "per-model line counts cache too",
    );
  });
  console.log("  ✓ stats usage counts cache read/write as input");
}

// --- Verdict mode: Pareto frontier ---

export function testVerdictDominatedRowNamesDominator(): void {
  // Fixture: three models in "code" regime.
  // opus (q3.8, 14M) is dominated by ling (q3.8, 1.1M) — same quality, 12.7× token.
  // glm  (q3.8, 2.5M) is dominated by ling — same quality, 2.3× token.
  // ling (q3.8, 1.1M) is on the frontier (cheapest at its quality).
  // muse (q4.0, 23M) is also on the frontier (highest quality, despite expensive).
  const data: import("../src/stats/data.js").StatsData = {
    scope: "test-project",
    runs: {
      total: 50,
      byStatus: {},
      passRate: 1,
      stallRate: 0,
      avgRounds: 1,
      avgMinutes: 5,
    },
    stages: { exec: { avg: 5, count: 50 }, review: { avg: 2, count: 50 } },
    byModel: [],
    modelAttribution: { inferred: 0, declared: 0, none: 0 },
    byGrade: [],
    byWorktree: [],
    byReasonCode: [],
    byPlan: [],
    escalatedRuns: [],
    bestPassing: [],
    recentVerdictNotes: [],
    byFile: [],
    byPlanMode: [],
    byRegime: [
      {
        worktree: "wt1",
        regime: "code",
        model: "muse-spark",
        gates: 8,
        fails: 0,
        failRate: 0,
        avgQuality: 4.0,
        tokensInput: null,
        tokensOutput: null,
        passes: 8,
        tokensPerPass: 23_000_000,
      },
      {
        worktree: "wt1",
        regime: "code",
        model: "ling-3.0-flash",
        gates: 12,
        fails: 0,
        failRate: 0,
        avgQuality: 3.8,
        tokensInput: null,
        tokensOutput: null,
        passes: 12,
        tokensPerPass: 1_100_000,
      },
      {
        worktree: "wt1",
        regime: "code",
        model: "claude-opus-5",
        gates: 10,
        fails: 0,
        failRate: 0,
        avgQuality: 3.8,
        tokensInput: null,
        tokensOutput: null,
        passes: 10,
        tokensPerPass: 14_000_000,
      },
      {
        worktree: "wt1",
        regime: "code",
        model: "z-ai/glm-5.3",
        gates: 9,
        fails: 0,
        failRate: 0,
        avgQuality: 3.8,
        tokensInput: null,
        tokensOutput: null,
        passes: 9,
        tokensPerPass: 2_500_000,
      },
    ],
    usage: {
      session_count: 0,
      total_tokens_input: 0,
      total_tokens_output: 0,
      total_tokens_reasoning: 0,
      total_tokens_cache_read: 0,
      total_tokens_cache_write: 0,
      total_cost: 0,
      by_model: [],
    },
    latestRunAt: "2026-09-17T00:00:00Z",
  };

  const text = formatVerdictText(data, "code");

  // Frontier should contain ling (cheapest at q3.8) and muse (highest quality at q4.0)
  assert.ok(text.includes("ling-3.0-flash"), "frontier should contain ling");
  assert.ok(text.includes("muse-spark"), "frontier should contain muse");

  // opus should be dominated by ling with 12.7× token ratio
  assert.ok(
    text.includes("claude-opus-5"),
    "dominated section should contain opus",
  );
  assert.ok(
    text.includes("← ling-3.0-flash dominates, 12.7× tokens"),
    "opus should cite ling as dominator with 12.7× ratio",
  );

  // glm should be dominated by ling with 2.3× token ratio
  assert.ok(
    text.includes("z-ai/glm-5.3"),
    "dominated section should contain glm",
  );
  assert.ok(
    text.includes("← ling-3.0-flash dominates, 2.3× tokens"),
    "glm should cite ling as dominator with 2.3× ratio",
  );

  // muse should NOT be in the dominated section
  const dominatedSection = text.split("dominated:")[1] ?? "";
  assert.ok(
    !dominatedSection.includes("muse-spark"),
    "muse should be on frontier, not dominated",
  );
}

export function testVerdictSingleModelShowsDash(): void {
  const data: import("../src/stats/data.js").StatsData = {
    scope: "test",
    runs: {
      total: 5,
      byStatus: {},
      passRate: 1,
      stallRate: 0,
      avgRounds: 1,
      avgMinutes: 1,
    },
    stages: { exec: { avg: 1, count: 5 }, review: { avg: 1, count: 5 } },
    byModel: [],
    modelAttribution: { inferred: 0, declared: 0, none: 0 },
    byGrade: [],
    byWorktree: [],
    byReasonCode: [],
    byPlan: [],
    escalatedRuns: [],
    bestPassing: [],
    recentVerdictNotes: [],
    byFile: [],
    byPlanMode: [],
    byRegime: [
      {
        worktree: "wt1",
        regime: "code",
        model: "sonnet-5",
        gates: 6,
        fails: 0,
        failRate: 0,
        avgQuality: 4.0,
        tokensInput: null,
        tokensOutput: null,
        passes: 6,
        tokensPerPass: 5_000_000,
      },
    ],
    usage: {
      session_count: 0,
      total_tokens_input: 0,
      total_tokens_output: 0,
      total_tokens_reasoning: 0,
      total_tokens_cache_read: 0,
      total_tokens_cache_write: 0,
      total_cost: 0,
      by_model: [],
    },
    latestRunAt: "2026-09-17T00:00:00Z",
  };

  const text = formatVerdictText(data, "code");
  assert.ok(text.includes("sonnet-5"), "should show the single model");
  assert.ok(
    text.includes("no comparison yet"),
    "single model should show no-comparison hint",
  );
}

export function testVerdictThinNeverDominates(): void {
  const data: import("../src/stats/data.js").StatsData = {
    scope: "test",
    runs: {
      total: 3,
      byStatus: {},
      passRate: 1,
      stallRate: 0,
      avgRounds: 1,
      avgMinutes: 1,
    },
    stages: { exec: { avg: 1, count: 3 }, review: { avg: 1, count: 3 } },
    byModel: [],
    modelAttribution: { inferred: 0, declared: 0, none: 0 },
    byGrade: [],
    byWorktree: [],
    byReasonCode: [],
    byPlan: [],
    escalatedRuns: [],
    bestPassing: [],
    recentVerdictNotes: [],
    byFile: [],
    byPlanMode: [],
    byRegime: [
      {
        worktree: "wt1",
        regime: "code",
        model: "model-a",
        gates: 3,
        fails: 0,
        failRate: 0,
        avgQuality: 4.0,
        tokensInput: null,
        tokensOutput: null,
        passes: 3,
        tokensPerPass: 1_000_000,
      },
      {
        worktree: "wt1",
        regime: "code",
        model: "model-b",
        gates: 2,
        fails: 0,
        failRate: 0,
        avgQuality: 3.5,
        tokensInput: null,
        tokensOutput: null,
        passes: 2,
        tokensPerPass: 2_000_000,
      },
    ],
    usage: {
      session_count: 0,
      total_tokens_input: 0,
      total_tokens_output: 0,
      total_tokens_reasoning: 0,
      total_tokens_cache_read: 0,
      total_tokens_cache_write: 0,
      total_cost: 0,
      by_model: [],
    },
    latestRunAt: "2026-09-17T00:00:00Z",
  };

  const text = formatVerdictText(data, "code");
  // Both models are under MIN_N, so nobody earns the frontier and nobody is
  // reported as dominating anyone — one lucky run must not set the yardstick.
  assert.ok(
    text.includes("no model at n\u22655 yet"),
    "all-thin regime should decline to rank",
  );
  assert.ok(
    text.includes("closest: model-a, n=3"),
    "should name the closest model",
  );
  assert.ok(
    text.includes("candidates (n<5"),
    "thin models belong in candidates",
  );
  assert.ok(!text.includes("dominates"), "a thin model must never dominate");
}

export function testVerdictNoRegimeShowsOneLinerPerRegime(): void {
  const data: import("../src/stats/data.js").StatsData = {
    scope: "test",
    runs: {
      total: 20,
      byStatus: {},
      passRate: 1,
      stallRate: 0,
      avgRounds: 1,
      avgMinutes: 3,
    },
    stages: { exec: { avg: 3, count: 20 }, review: { avg: 1, count: 20 } },
    byModel: [],
    modelAttribution: { inferred: 0, declared: 0, none: 0 },
    byGrade: [],
    byWorktree: [],
    byReasonCode: [],
    byPlan: [],
    escalatedRuns: [],
    bestPassing: [],
    recentVerdictNotes: [],
    byFile: [],
    byPlanMode: [],
    byRegime: [
      {
        worktree: "wt1",
        regime: "code",
        model: "sonnet",
        gates: 10,
        fails: 0,
        failRate: 0,
        avgQuality: 3.8,
        tokensInput: null,
        tokensOutput: null,
        passes: 10,
        tokensPerPass: 3_000_000,
      },
      {
        worktree: "wt1",
        regime: "fix",
        model: "opus",
        gates: 5,
        fails: 0,
        failRate: 0,
        avgQuality: 4.0,
        tokensInput: null,
        tokensOutput: null,
        passes: 5,
        tokensPerPass: 10_000_000,
      },
      {
        worktree: "wt1",
        regime: "fix",
        model: "glm",
        gates: 3,
        fails: 0,
        failRate: 0,
        avgQuality: 3.8,
        tokensInput: null,
        tokensOutput: null,
        passes: 3,
        tokensPerPass: 2_000_000,
      },
    ],
    usage: {
      session_count: 0,
      total_tokens_input: 0,
      total_tokens_output: 0,
      total_tokens_reasoning: 0,
      total_tokens_cache_read: 0,
      total_tokens_cache_write: 0,
      total_cost: 0,
      by_model: [],
    },
    latestRunAt: "2026-09-17T00:00:00Z",
  };

  const text = formatVerdictText(data);
  // Without --regime it is strictly one line per regime — no breakdown blocks.
  assert.ok(/code\s+\(10\)/.test(text), "should show code regime gate count");
  assert.ok(/fix\s+\(8\)/.test(text), "should show fix regime gate count");
  assert.ok(
    !text.includes("frontier"),
    "summary view must not print breakdowns",
  );
  assert.ok(
    !text.includes("candidates"),
    "summary view must not print breakdowns",
  );

  // fix: opus (n=5) is rankable, glm (n=3) is not — the pick must be opus.
  const fixLine = text.split("\n").find((l) => l.includes("fix")) ?? "";
  assert.ok(fixLine.includes("opus"), "fix should pick the rankable model");
  assert.ok(!fixLine.includes("glm"), "a thin model must not be the pick");

  // Regimes with nothing graded are shown as zero, not omitted.
  assert.ok(
    /test\s+\(0\)\s+— no graded work/.test(text),
    "test regime shown as empty",
  );
}

export function testStatsRegimeTokensSplitNotDuplicated(): void {
  withTmpDb((db) => {
    // One session, two gates, two regimes. Until 2026-09-19 each regime bucket
    // was charged the session's whole total, so a model used across N regimes
    // looked N times more expensive than one used in a single regime — and
    // `--mode verdict` ranks on exactly that number.
    const r1 = newRun(db, "wt1", null, null, "abc");
    addEvent(db, r1, "gate", {
      verdict: "pass-good",
      note: "",
      round: 0,
      regime: "code",
      session_id: "sess-split",
      reason_code: "none",
      source: "mcp",
    });
    setStatus(db, r1, "passed");

    const r2 = newRun(db, "wt1", null, null, "abc");
    addEvent(db, r2, "gate", {
      verdict: "pass-good",
      note: "",
      round: 0,
      regime: "review",
      session_id: "sess-split",
      reason_code: "none",
      source: "mcp",
    });
    setStatus(db, r2, "passed");

    withOpenCodeSession(
      "sess-split",
      { input: 60000, output: 10000, cacheRead: 0, cacheWrite: 0 },
      () => {
        const data = getStatsData();
        const code = data.byRegime.find((r) => r.regime === "code");
        const review = data.byRegime.find((r) => r.regime === "review");
        assert.ok(code && review, "both regime rows must exist");
        assert.equal(code.tokensInput, 30000, "code gets its half");
        assert.equal(review.tokensInput, 30000, "review gets its half");
        assert.equal(
          (code.tokensInput ?? 0) + (review.tokensInput ?? 0),
          60000,
          "shares must sum back to the session total, not double it",
        );
        // by-model is one bucket for this session, so it keeps the full total.
        assert.equal(data.byModel.length, 1);
        assert.equal(data.byModel[0].tokensInput, 60000);
      },
    );
  });
  console.log(
    "  ✓ getStatsData: session tokens split across regimes, not duplicated",
  );
}
