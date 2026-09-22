import { test } from "bun:test";
// test/stats/plan-mode.test.ts — plan mode split, regime split, countPendingPlans

import assert from "node:assert";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { addEvent, newRun, setStatus } from "../../src/db/store.js";
import { countPendingPlans, getStatsData } from "../../src/stats/index.js";
import { withTmpDb } from "./helpers.js";

test("testStatsByPlanModeSplit", () => {
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
});

test("testStatsByRegimeSplit", () => {
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
});

test("testCountPendingPlans", () => {
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
});
