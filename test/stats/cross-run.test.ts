import { test } from "bun:test";
// test/stats/cross-run.test.ts — cross-run knowledge (reason codes, escalation,
// plan breakdown, best passing, pass rate, verdict notes, file risk)

import assert from "node:assert";
import {
  addEvent,
  incrementRound,
  newRun,
  setStatus,
} from "../../src/db/store.js";
import { getStatsData } from "../../src/stats/index.js";
import { withTmpDb } from "./helpers.js";

test("testStatsReasonCodeBreakdown", () => {
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
});

test("testStatsEscalatedRuns", () => {
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
});

test("testStatsPlanBreakdown", () => {
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
});

test("testStatsBestPassing", () => {
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
});

test("testStatsPassRateFromVerdicts", () => {
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
});

/**
 * Tripwire: getStatsData must collect MORE notes than project_health_context
 * displays. It filters by worktree/files[] before slicing to 3, so a
 * collection cap of 3 here silently hides every file-scoped match older than
 * the three newest gates in the whole DB.
 */
test("testStatsVerdictNotesNotCappedAtDisplayLimit", () => {
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
});

test("testStatsByFileRisk", () => {
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
});
