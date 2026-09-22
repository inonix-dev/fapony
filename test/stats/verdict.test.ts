import { test } from "bun:test";
// test/stats/verdict.test.ts — verdict mode: Pareto frontier + summary view

import assert from "node:assert";
import type { StatsData } from "../../src/stats/data.js";
import { formatVerdictText } from "../../src/stats/index.js";

function baseData(overrides: Partial<StatsData> = {}): StatsData {
  return {
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
    byRegime: [],
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
    ...overrides,
  };
}

test("testVerdictDominatedRowNamesDominator", () => {
  // Fixture: three models in "code" regime.
  // opus (q3.8, 14M) is dominated by ling (q3.8, 1.1M) — same quality, 12.7× token.
  // glm  (q3.8, 2.5M) is dominated by ling — same quality, 2.3× token.
  // ling (q3.8, 1.1M) is on the frontier (cheapest at its quality).
  // muse (q4.0, 23M) is also on the frontier (highest quality, despite expensive).
  const data = baseData({
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
  });

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
});

test("testVerdictSingleModelShowsDash", () => {
  const data = baseData({
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
  });

  const text = formatVerdictText(data, "code");
  assert.ok(text.includes("sonnet-5"), "should show the single model");
  assert.ok(
    text.includes("no comparison yet"),
    "single model should show no-comparison hint",
  );
});

test("testVerdictThinNeverDominates", () => {
  const data = baseData({
    runs: {
      total: 3,
      byStatus: {},
      passRate: 1,
      stallRate: 0,
      avgRounds: 1,
      avgMinutes: 1,
    },
    stages: { exec: { avg: 1, count: 3 }, review: { avg: 1, count: 3 } },
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
  });

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
});

test("testVerdictNoRegimeShowsOneLinerPerRegime", () => {
  const data = baseData({
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
  });

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
});
