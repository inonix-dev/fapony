import { test } from "bun:test";
import assert from "node:assert";
import { getRun, newRun, setStatus } from "../src/db/store.js";
import { gateOnce } from "../src/gate.js";
import { withTmpDb } from "./helpers.js";

test("testGateOncePass", () => {
  withTmpDb((db) => {
    const runId = newRun(db, "test-wt", "plan.md", "mem-1", "abc123");
    setStatus(db, runId, "awaiting_review");

    const result = gateOnce(runId, "pass", "looks good");
    assert.equal(result.status, "passed");
    assert.equal(result.error, undefined);

    const run = getRun(db, runId);
    assert.equal(run?.status, "passed");

    const events = db
      .prepare("SELECT * FROM events WHERE run_id = ? AND kind = 'gate'")
      .all(runId) as { data: string }[];
    assert.equal(events.length, 1);
    const data = JSON.parse(events[0].data);
    assert.equal(data.verdict, "pass");
    assert.equal(data.note, "looks good");
    assert.equal(data.round, 0);
  });

  console.log("  ✓ gateOnce pass");
});

test("testGateOnceFail", () => {
  withTmpDb((db) => {
    const runId = newRun(db, "test-wt", "plan.md", "mem-1", "abc123");
    setStatus(db, runId, "awaiting_review");

    const result = gateOnce(runId, "fail", "fix auth");
    assert.equal(result.status, "fixing");
    assert.equal(result.round, 1);

    const run = getRun(db, runId);
    assert.equal(run?.status, "fixing");
    assert.equal(run?.round, 1);
  });

  console.log("  ✓ gateOnce fail");
});

test("testGateOnceAlreadyPassed", () => {
  withTmpDb((db) => {
    const runId = newRun(db, "test-wt", "plan.md", "mem-1", "abc123");
    setStatus(db, runId, "passed");

    const result = gateOnce(runId, "pass", "");
    assert.equal(result.status, "passed");
    assert(result.error?.includes("already"), "should say already passed");
  });

  console.log("  ✓ gateOnce already passed");
});

test("testGateOnceAlreadyStalled", () => {
  withTmpDb((db) => {
    const runId = newRun(db, "test-wt", "plan.md", "mem-1", "abc123");
    setStatus(db, runId, "stalled");

    const result = gateOnce(runId, "fail", "one more try");
    assert.equal(result.status, "stalled");
    assert(result.error?.includes("already"), "should say already stalled");
  });

  console.log("  ✓ gateOnce already stalled");
});

test("testGateOnceMaxRounds", () => {
  withTmpDb((db) => {
    const runId = newRun(db, "test-wt", "plan.md", "mem-1", "abc123");
    setStatus(db, runId, "awaiting_review");

    // Fail twice — round 1 and 2 (still allowed since 2 > 2 is false)
    gateOnce(runId, "fail", "round 1");
    const r1 = getRun(db, runId)!;
    assert.equal(r1.round, 1);

    setStatus(db, runId, "awaiting_review");
    gateOnce(runId, "fail", "round 2");
    const r2 = getRun(db, runId)!;
    assert.equal(r2.round, 2);

    // Third fail — round 3 > 2, so stalls (back to the human, no more fixes)
    setStatus(db, runId, "awaiting_review");
    const result = gateOnce(runId, "fail", "round 3");
    assert.equal(result.status, "stalled");
    assert(result.error?.includes("maxRounds"), "should mention maxRounds");
    assert(
      result.error?.includes("human"),
      "should tell the caller to go back to the human",
    );

    // stalled must be persisted (run must not sit in 'fixing' forever)
    assert.equal(getRun(db, runId)?.status, "stalled");
    const stops = db
      .prepare("SELECT * FROM events WHERE run_id = ? AND kind = 'stop'")
      .all(runId) as { data: string }[];
    assert.equal(stops.length, 1);
  });

  console.log("  ✓ gateOnce max rounds");
});

test("testGateOncePassExcellent", () => {
  withTmpDb((db) => {
    const runId = newRun(db, "test-wt", "plan.md", "mem-1", "abc123");
    setStatus(db, runId, "awaiting_review");

    const result = gateOnce(runId, "pass-excellent", "edge cases verified");
    assert.equal(result.status, "passed");

    const events = db
      .prepare("SELECT * FROM events WHERE run_id = ? AND kind = 'gate'")
      .all(runId) as { data: string }[];
    assert.equal(events.length, 1);
    assert.deepEqual(JSON.parse(events[0].data), {
      verdict: "pass-excellent",
      note: "edge cases verified",
      round: 0,
    });
  });

  console.log("  ✓ gateOnce pass-excellent");
});

test("testGateOncePassGood", () => {
  withTmpDb((db) => {
    const runId = newRun(db, "test-wt", "plan.md", "mem-1", "abc123");
    setStatus(db, runId, "awaiting_review");

    const result = gateOnce(runId, "pass-good", "minor risks noted");
    assert.equal(result.status, "passed");

    const events = db
      .prepare("SELECT * FROM events WHERE run_id = ? AND kind = 'gate'")
      .all(runId) as { data: string }[];
    assert.equal(events.length, 1);
    assert.deepEqual(JSON.parse(events[0].data), {
      verdict: "pass-good",
      note: "minor risks noted",
      round: 0,
    });
  });

  console.log("  ✓ gateOnce pass-good");
});

test("testGateOncePassAdequate", () => {
  withTmpDb((db) => {
    const runId = newRun(db, "test-wt", "plan.md", "mem-1", "abc123");
    setStatus(db, runId, "awaiting_review");

    const result = gateOnce(runId, "pass-adequate", "residual risk documented");
    assert.equal(result.status, "passed");

    const events = db
      .prepare("SELECT * FROM events WHERE run_id = ? AND kind = 'gate'")
      .all(runId) as { data: string }[];
    assert.equal(events.length, 1);
    assert.deepEqual(JSON.parse(events[0].data), {
      verdict: "pass-adequate",
      note: "residual risk documented",
      round: 0,
    });
  });

  console.log("  ✓ gateOnce pass-adequate");
});

test("testGateOnceUncertain", () => {
  withTmpDb((db) => {
    const runId = newRun(db, "test-wt", "plan.md", "mem-1", "abc123");
    setStatus(db, runId, "awaiting_review");

    const result = gateOnce(
      runId,
      "uncertain",
      "handoff missing checks section",
    );
    assert.equal(result.status, "stopped");
    assert.equal(result.error, undefined);

    const run = getRun(db, runId);
    assert.equal(run?.status, "stopped");

    // gate event stores raw verdict + round
    const gates = db
      .prepare("SELECT * FROM events WHERE run_id = ? AND kind = 'gate'")
      .all(runId) as { data: string }[];
    assert.equal(gates.length, 1);
    assert.deepEqual(JSON.parse(gates[0].data), {
      verdict: "uncertain",
      note: "handoff missing checks section",
      round: 0,
    });

    // stop event with reason=verdict_uncertain
    const stops = db
      .prepare("SELECT * FROM events WHERE run_id = ? AND kind = 'stop'")
      .all(runId) as { data: string }[];
    assert.equal(stops.length, 1);
    assert.deepEqual(JSON.parse(stops[0].data), {
      reason: "verdict_uncertain",
    });
  });

  console.log("  ✓ gateOnce uncertain");
});
