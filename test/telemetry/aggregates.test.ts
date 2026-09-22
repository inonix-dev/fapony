// test/telemetry/aggregates.test.ts — telemetry aggregates from real runs

import assert from "node:assert";
import { addEvent, newRun, setStatus } from "../../src/db/store.js";
import { buildPayload } from "../../src/telemetry.js";
import { withTmpDb } from "./helpers.js";

export function testTelemetryAggregatesFromRuns(): void {
  withTmpDb((db) => {
    // Create 2 runs: one passed, one stalled
    const run1 = newRun(db, "/Users/test/project", null, null, "abc123");
    const run2 = newRun(db, "/Users/test/project", null, null, "def456");

    addEvent(db, run1, "spawn", { role: "executor", model: "mimo-v2" });
    addEvent(db, run2, "spawn", { role: "executor", model: "mimo-v2" });

    // Add gate events
    addEvent(db, run1, "gate", {
      verdict: "pass-good",
      note: "looks good",
      round: 1,
    });
    addEvent(db, run2, "gate", {
      verdict: "fail",
      note: "needs work",
      round: 1,
    });

    // Set statuses
    setStatus(db, run1, "passed");
    setStatus(db, run2, "stalled");

    const payload = buildPayload();

    assert.equal(payload.machine.total_runs, 2);
    assert.equal(payload.machine.by_status.passed, 1);
    assert.equal(payload.machine.by_status.stalled, 1);
    assert.equal(payload.machine.pass_rate, 0.5);
    assert.equal(payload.machine.stall_rate, 0.5);
    // By model
    assert.ok(payload.machine.by_model.length > 0);
    const mimo = payload.machine.by_model.find((m) => m.model === "mimo-v2");
    assert.ok(mimo, "mimo-v2 model found");
    assert.equal(mimo.gate_count, 2);

    // By grade
    const passGood = payload.machine.by_grade.find(
      (g) => g.grade === "pass-good",
    );
    assert.ok(passGood);
    assert.equal(passGood.count, 1);
    const fail = payload.machine.by_grade.find((g) => g.grade === "fail");
    assert.ok(fail);
    assert.equal(fail.count, 1);

    // By worktree (basename only)
    assert.ok(payload.machine.by_worktree.length > 0);
    const wt = payload.machine.by_worktree[0];
    assert.equal(wt.worktree, "project"); // basename, not full path
    assert.equal(wt.runs, 2);
    assert.equal(wt.passed, 1);
    assert.equal(wt.stalled, 1);
  });

  console.log("  ✓ telemetry aggregates from real runs");
}

export function testTelemetryWorktreeRedacted(): void {
  withTmpDb((db) => {
    const run = newRun(db, "/very/long/path/to/my/project", null, null, "abc");
    setStatus(db, run, "passed");

    const payload = buildPayload();
    assert.equal(payload.machine.by_worktree[0].worktree, "project");
    assert.ok(
      !JSON.stringify(payload).includes("/very/long/path"),
      "full path not in payload",
    );
  });

  console.log("  ✓ telemetry redacts worktree paths to basename");
}

export function testTelemetryPerRoundModelMultiRound(): void {
  // Regression: gate windows must be per-round (disjoint), never cumulative.
  // Each gate sees only its own round's spawn.
  withTmpDb((db) => {
    const run = newRun(db, "/Users/test/project", null, null, "abc");
    addEvent(db, run, "spawn", { role: "executor", model: "m1" });
    addEvent(db, run, "gate", { verdict: "pass-good", note: "", round: 1 });
    addEvent(db, run, "spawn", { role: "executor", model: "m2" });
    addEvent(db, run, "gate", { verdict: "pass-good", note: "", round: 2 });
    setStatus(db, run, "passed");

    const payload = buildPayload();
    const m1 = payload.machine.by_model.find((x) => x.model === "m1");
    const m2 = payload.machine.by_model.find((x) => x.model === "m2");
    assert.ok(m1 && m2, "both round models attributed separately");
    assert.equal(m1.gate_count, 1);
    assert.equal(m2.gate_count, 1);
    assert.equal(m1.avg_quality, 4);
  });

  console.log("  ✓ telemetry per-round (not cumulative) model attribution");
}
