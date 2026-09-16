// test/context.test.ts — project-health context block (PLAN-project-health-context step 4)

import assert from "node:assert";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  buildProjectHealthContext,
  computeModelFit,
} from "../src/context/index.js";
import {
  addEvent,
  incrementRound,
  newRun,
  setStatus,
} from "../src/db/index.js";
import { toolProjectHealthContext } from "../src/mcp/tools/context.js";
import { EMPTY_RESULT } from "../src/session/index.js";
import { getStatsData, type StatsData } from "../src/stats.js";
import { withTempRepo, withTmpDb } from "./helpers.js";

function statsFixture(): StatsData {
  return {
    scope: null,
    runs: {
      total: 23,
      byStatus: { passed: 20, stopped: 3 },
      passRate: 0.87,
      stallRate: 0,
      avgRounds: 1.2,
      avgMinutes: 30,
    },
    stages: {
      exec: { avg: 0, count: 0 },
      review: { avg: 0, count: 0 },
    },
    byModel: [],
    byGrade: [],
    byWorktree: [
      { worktree: "wt1", runs: 23, passed: 20, stalled: 0, pending: null },
    ],
    byReasonCode: [
      { worktree: "wt1", reason: "scope_mismatch", count: 7 },
      { worktree: "wt1", reason: "missing_test", count: 4 },
      { worktree: "wt1", reason: "spec_gap", count: 2 },
      { worktree: "wt1", reason: "other", count: 1 },
    ],
    byPlan: [],
    escalatedRuns: [
      { id: 7, worktree: "wt1", plan: "auth-refactor", round: 3 },
      { id: 9, worktree: "wt1", plan: "auth-refactor", round: 4 },
    ],
    bestPassing: [{ plan: "usage-web-cli", worktree: "wt1" }],
    recentVerdictNotes: [],
    byFile: [],
    byPlanMode: [],
    byRegime: [],
    modelAttribution: { inferred: 0, declared: 0, none: 0 },
    usage: EMPTY_RESULT,
    latestRunAt: "",
  };
}

export function testContextBlockSnapshot(): void {
  const block = buildProjectHealthContext(statsFixture());
  assert.equal(
    block,
    [
      "## Known patterns for this project (from fapony history, N=23 runs, all worktrees)",
      "- Recurring fail reasons (non-pass gates): scope_mismatch (7×), missing_test (4×), spec_gap (2×) — watch for these in the new plan.",
      '- 2 runs escalated past the round cap (e.g. plan "auth-refactor", round 3) — likely the plan was underspecified, not the code.',
      '- Passed round 1 before: "usage-web-cli" — shapes worth reusing when they fit.',
    ].join("\n"),
  );
  console.log("  ✓ context block matches spec §3 shape");
}

export function testContextBlockLowHistory(): void {
  const data = statsFixture();
  data.runs.total = 2;
  data.byWorktree = [
    { worktree: "wt1", runs: 2, passed: 2, stalled: 0, pending: null },
  ];
  const block = buildProjectHealthContext(data);
  assert.ok(block.includes("Not enough history yet (2 runs, need 5+)"));
  assert.ok(!block.includes("scope_mismatch"), "no reason noise on n=2");
  console.log("  ✓ context block guards low sample size");
}

export function testContextBlockWorktreeScope(): void {
  const data = statsFixture();
  const block = buildProjectHealthContext(data, { worktree: "wt-empty" });
  // Unknown worktree → 0 runs → low-history line, never another tree's trends.
  assert.ok(block.includes("N=0 runs, wt-empty"));
  assert.ok(!block.includes("scope_mismatch"));
  console.log("  ✓ context block scopes to worktree");
}

export function testContextBlockNoPatterns(): void {
  const data = statsFixture();
  data.byReasonCode = [];
  data.escalatedRuns = [];
  data.bestPassing = [];
  const block = buildProjectHealthContext(data);
  assert.ok(block.includes("No recurring failure or escalation patterns"));
  console.log("  ✓ context block handles clean history");
}

export function testContextBlockLineCap(): void {
  const data = statsFixture();
  data.byReasonCode = Array.from({ length: 30 }, (_, i) => ({
    worktree: "wt1",
    reason: `reason_${i}`,
    count: 30 - i,
  }));
  const block = buildProjectHealthContext(data);
  assert.ok(block.split("\n").length <= 15, "capped at ~15 lines");
  assert.ok(!block.includes("reason_3"), "top-3 reasons only");
  console.log("  ✓ context block caps reasons and total lines");
}

export function testContextToolEndToEnd(): void {
  withTmpDb((db) => {
    for (let i = 0; i < 5; i++) {
      const r = newRun(db, "wt1", `plan-${i}`, null, "abc");
      addEvent(db, r, "gate", {
        verdict: "fail",
        reason_code: "scope_mismatch",
        note: "",
        round: 0,
      });
      setStatus(db, r, "fixing");
    }
    const esc = newRun(db, "wt1", "big-plan", null, "abc");
    incrementRound(db, esc);
    incrementRound(db, esc);
    incrementRound(db, esc);

    const data = getStatsData();
    const expected = buildProjectHealthContext(data, { worktree: "wt1" });
    const result = toolProjectHealthContext({ worktree: "wt1" });
    assert.equal(result.isError, undefined);
    assert.equal(result.content[0].text, expected);
    assert.ok(expected.includes("scope_mismatch (5×)"));
    assert.ok(expected.includes("1 run escalated past the round cap"));
  });
  console.log("  ✓ project_health_context tool returns block from real events");
}

export function testContextBlockRecentNotes(): void {
  const data = statsFixture();
  data.recentVerdictNotes = [
    {
      worktree: "wt1",
      reason: "scope_mismatch",
      note: "used old API shape",
      ts: "",
    },
  ];
  const block = buildProjectHealthContext(data);
  assert.ok(
    block.includes("Recent verdict notes: [scope_mismatch] used old API shape"),
  );
  console.log("  ✓ context block surfaces recent verdict note text");
}

export function testContextBlockLowHistoryStillShowsNotes(): void {
  const data = statsFixture();
  data.runs.total = 1;
  data.byWorktree = [
    { worktree: "wt1", runs: 1, passed: 0, stalled: 0, pending: null },
  ];
  data.recentVerdictNotes = [
    {
      worktree: "wt1",
      reason: "spec_gap",
      note: "spec missed edge case",
      ts: "",
    },
  ];
  const block = buildProjectHealthContext(data);
  assert.ok(block.includes("Not enough history yet"));
  assert.ok(
    block.includes("Recent verdict notes: [spec_gap] spec missed edge case"),
    "note text surfaces even below minRuns — signal from N=1",
  );
  console.log("  ✓ context block shows notes even below minRuns threshold");
}

export function testContextToolEmptyDb(): void {
  withTmpDb(() => {
    const result = toolProjectHealthContext({});
    assert.ok(result.content[0].text.includes("Not enough history yet"));
  });
  console.log("  ✓ project_health_context on empty db → low-history line");
}

export function testContextBlockFilesFilterBeyondTop3(): void {
  const data = statsFixture();
  data.recentVerdictNotes = [
    { worktree: "wt1", reason: "other", note: "unrelated one", ts: "" },
    { worktree: "wt1", reason: "other", note: "unrelated two", ts: "" },
    { worktree: "wt1", reason: "other", note: "unrelated three", ts: "" },
    {
      worktree: "wt1",
      reason: "spec_gap",
      note: "findSessionModel picks first model",
      ts: "",
      files: ["src/session/findModel.ts"],
    },
  ];
  const block = buildProjectHealthContext(data, {
    files: ["src/session/findModel.ts"],
  });
  assert.ok(
    block.includes("findSessionModel picks first model"),
    "match past the top-3 cutoff still surfaces when files[] is given",
  );
  assert.ok(
    !block.includes("unrelated one"),
    "non-matching notes stay filtered out",
  );
  console.log("  ✓ context block files filter applies before the top-3 slice");
}

export function testComputeModelFit(): void {
  const byRegime: StatsData["byRegime"] = [
    {
      worktree: "wt1",
      regime: "fix",
      model: "opus",
      gates: 9,
      fails: 2,
      failRate: 2 / 9,
      avgQuality: 3.8,
      tokensInput: null,
      tokensOutput: null,
      passes: 7,
      tokensPerPass: 48000,
    },
    {
      worktree: "wt1",
      regime: "fix",
      model: "sonnet",
      gates: 12,
      fails: 0,
      failRate: 0,
      avgQuality: 4.1,
      tokensInput: null,
      tokensOutput: null,
      passes: 12,
      tokensPerPass: 21000,
    },
    {
      // gates < 5 → dropped (sample-size guard)
      worktree: "wt1",
      regime: "code",
      model: "tiny",
      gates: 3,
      fails: 0,
      failRate: 0,
      avgQuality: 5,
      tokensInput: null,
      tokensOutput: null,
      passes: 3,
      tokensPerPass: 1000,
    },
    {
      // other worktree → excluded when scoped
      worktree: "wt2",
      regime: "fix",
      model: "haiku",
      gates: 8,
      fails: 1,
      failRate: 1 / 8,
      avgQuality: 3,
      tokensInput: null,
      tokensOutput: null,
      passes: 7,
      tokensPerPass: 5000,
    },
  ];

  const scoped = computeModelFit(byRegime, "wt1");
  assert.deepEqual(
    scoped.map((f) => `${f.regime}:${f.model}`),
    ["fix:sonnet"],
    "lowest failRate wins; tiny dropped (<5 gates); wt2 excluded",
  );

  const all = computeModelFit(byRegime);
  assert.ok(
    all.some((f) => f.regime === "fix" && f.model === "sonnet"),
    "unscoped pick still excludes sub-threshold buckets",
  );
  assert.ok(!all.some((f) => f.model === "tiny"), "gates<5 never recommends");
  console.log(
    "  ✓ computeModelFit ranks by failRate with min-N + worktree guards",
  );
}

export function testContextBlockMemDecisions(): void {
  const data = statsFixture();
  const block = buildProjectHealthContext(data, {
    memDecisions: [
      { text: "ตัดสินใช้ SQLite ไม่ใช่ JSONL", spec: "PLAN-x.md" },
      { text: "cache ไม่คุ้ม ตัดออก" },
    ],
  });
  assert.ok(
    block.includes(
      '- Decisions on record (mem): "ตัดสินใช้ SQLite ไม่ใช่ JSONL" · "cache ไม่คุ้ม ตัดออก"',
    ),
    "mem decisions lead the block",
  );
  console.log("  ✓ context block surfaces mem decisions");
}

export function testContextBlockModelFitLine(): void {
  const data = statsFixture();
  data.byRegime = [
    {
      worktree: "wt1",
      regime: "fix",
      model: "sonnet",
      gates: 12,
      fails: 0,
      failRate: 0,
      avgQuality: 4.1,
      tokensInput: null,
      tokensOutput: null,
      passes: 12,
      tokensPerPass: 21000,
    },
  ];
  const block = buildProjectHealthContext(data, { worktree: "wt1" });
  assert.ok(
    block.includes(
      "- Model fit: regime=fix → sonnet (failRate 0%, quality 4.1, N=12, 21k tok/pass)",
    ),
    "model right-sizing renders from real buckets",
  );
  console.log("  ✓ context block surfaces model right-sizing");
}

export function testContextBlockHubLine(): void {
  const data = statsFixture();
  const block = buildProjectHealthContext(data, {
    hubs: [{ file: "src/stats/data.ts", dependents: 9, tested: false }],
  });
  assert.ok(
    block.includes(
      "- Hubs you are touching (high blast radius): src/stats/data.ts (imported by 9 files; untested)",
    ),
    "hub line renders with dependents count + untested flag",
  );

  const tested = buildProjectHealthContext(data, {
    hubs: [{ file: "src/stats/data.ts", dependents: 9, tested: true }],
  });
  assert.ok(
    tested.includes("imported by 9 files)"),
    "tested hub omits the untested flag",
  );
  console.log("  ✓ context block surfaces structural hubs");
}

export function testContextBlockHubLowHistory(): void {
  const data = statsFixture();
  data.runs.total = 2;
  data.byWorktree = [
    { worktree: "wt1", runs: 2, passed: 2, stalled: 0, pending: null },
  ];
  const block = buildProjectHealthContext(data, {
    hubs: [{ file: "hub.ts", dependents: 6, tested: false }],
  });
  assert.ok(block.includes("Not enough history yet"));
  assert.ok(
    block.includes("Hubs you are touching"),
    "hub is structural, not history — fires even at N=0",
  );
  console.log("  ✓ context block shows hub line even below minRuns");
}

export function testContextBlockHubSilentBelowThreshold(): void {
  const data = statsFixture();
  const block = buildProjectHealthContext(data, { hubs: [] });
  assert.ok(
    !block.includes("Hubs you are touching"),
    "no hub entries → no hub line (reflex guard, PLAN-hub-signal rule 8)",
  );
  console.log("  ✓ context block stays silent without hubs");
}

export function testContextBlockHubCapHolds(): void {
  const data = statsFixture();
  data.byReasonCode = Array.from({ length: 30 }, (_, i) => ({
    worktree: "wt1",
    reason: `reason_${i}`,
    count: 30 - i,
  }));
  const block = buildProjectHealthContext(data, {
    hubs: [
      { file: "a.ts", dependents: 30, tested: false },
      { file: "b.ts", dependents: 20, tested: true },
      { file: "c.ts", dependents: 10, tested: false },
      { file: "d.ts", dependents: 6, tested: false },
    ],
  });
  assert.ok(block.split("\n").length <= 15, "15-line cap still enforced");
  assert.ok(
    block.includes("Hubs you are touching (high blast radius): "),
    "hub line present",
  );
  assert.ok(block.includes("a.ts"), "top hub by dependents kept");
  assert.ok(
    !block.includes("d.ts"),
    "beyond top-3 entries truncated (PLAN §5 escape hatch)",
  );
  console.log("  ✓ context block hub line respects the 15-line cap");
}

export function testContextToolHubEndToEnd(): void {
  withTempRepo((dir) => {
    // hub.ts imported by exactly HUB_DEPENDENTS_MIN files (4 imps + leaf);
    // leaf.ts itself by 0.
    writeFileSync(join(dir, "hub.ts"), "export const hub = 1;\n");
    writeFileSync(join(dir, "leaf.ts"), "import { hub } from './hub.js';\n");
    for (let i = 0; i < 4; i++) {
      writeFileSync(
        join(dir, `imp${i}.ts`),
        "import { hub } from './hub.js';\n",
      );
    }
    const withHub = toolProjectHealthContext({
      worktree: dir,
      files: ["hub.ts", "leaf.ts"],
    });
    assert.ok(withHub.content[0].text.includes("hub.ts (imported by 5 files"));
    assert.ok(
      !withHub.content[0].text.includes("leaf.ts (imported by"),
      "1-dependent file stays silent — below threshold",
    );

    // files[] without worktree → no graph → no hub line, no throw.
    const noWorktree = toolProjectHealthContext({ files: ["hub.ts"] });
    assert.ok(!noWorktree.content[0].text.includes("Hubs you are touching"));
  });
  console.log(
    "  ✓ project_health_context hub detection end-to-end on a real repo",
  );
}
