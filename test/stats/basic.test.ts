import { test } from "bun:test";
// test/stats/basic.test.ts — basic getStatsData enrichment tests

import { Database } from "bun:sqlite";
import assert from "node:assert";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { addEvent, newRun, setStatus } from "../../src/db/store.js";
import { getStatsData } from "../../src/stats/index.js";
import {
  makeOpenCodeDb,
  makeZCodeDb,
  withOpenCodeEnv,
  withTmpDb,
} from "./helpers.js";

test("testStatsEmptyDb", () => {
  withTmpDb(() => {
    const data = getStatsData();
    assert.equal(data.runs.total, 0);
    assert.deepEqual(data.byModel, []);
    assert.deepEqual(data.byGrade, []);
    assert.deepEqual(data.byWorktree, []);
  });
  console.log("  ✓ getStatsData returns empty for no runs");
});

test("testStatsMultiRoundSeparateGates", () => {
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
});

test("testStatsLegacyPassMergedWithPassAdequate", () => {
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
});

test("testStatsByWorktree", () => {
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
});

test("testStatsModelFromExecutorSpawn", () => {
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
});

test("testStatsModelFromSessionIdWhenNoSpawn", () => {
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
    const { dbPath, close } = makeOpenCodeDb(dir);
    const ocdb = new Database(dbPath);
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

    withOpenCodeEnv(dbPath, () => {
      const data = getStatsData();
      assert.equal(data.byModel.length, 1);
      assert.equal(data.byModel[0].model, "claude-sonnet-5");
    });
    close();
  });
  console.log(
    "  ✓ getStatsData: model from session_id when no spawn in window",
  );
});

test("testStatsSpawnModelWinsOverSessionId", () => {
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
    const { dbPath, close } = makeOpenCodeDb(dir);
    const ocdb = new Database(dbPath);
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

    withOpenCodeEnv(dbPath, () => {
      const data = getStatsData();
      assert.equal(data.byModel.length, 1);
      // Spawn model wins — session_id is fallback only
      assert.equal(data.byModel[0].model, "mimo-v2");
    });
    close();
  });
  console.log("  ✓ getStatsData: spawn model wins over session_id fallback");
});

test("testStatsByModelGroupsByClientProviderAgent", () => {
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
    const { dbPath: zcPath, close: closeZC } = makeZCodeDb(dir);
    const zdb = new Database(zcPath);
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

    const { dbPath: ocPath, close: closeOC } = makeOpenCodeDb(dir);
    const ocdb = new Database(ocPath);
    ocdb
      .prepare(
        `INSERT INTO session (id, project_id, model, time_created) VALUES (?, ?, ?, ?)`,
      )
      .run(
        "sess-oc-1",
        "p1",
        '{"providerID":"other-provider","id":"GLM-5.3-Flash"}',
        1000,
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
    }
    closeOC();
    closeZC();
  });
  console.log("  ✓ getStatsData: byModel splits same model across providers");
});
