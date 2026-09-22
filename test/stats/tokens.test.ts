import { test } from "bun:test";
// test/stats/tokens.test.ts — token counting, cost/pass, usage display

import { Database } from "bun:sqlite";
import assert from "node:assert";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { addEvent, newRun, setStatus } from "../../src/db/store.js";
import { EMPTY_RESULT } from "../../src/session/index.js";
import { formatStatsText, getStatsData } from "../../src/stats/index.js";
import {
  makeOpenCodeDb,
  withOpenCodeEnv,
  withOpenCodeSession,
  withTmpDb,
} from "./helpers.js";

test("testStatsTokensInByModel", () => {
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
    const { dbPath, close } = makeOpenCodeDb(dir);
    const ocdb = new Database(dbPath);
    ocdb
      .prepare(`INSERT INTO project (id, worktree) VALUES (?, ?)`)
      .run("p1", "/tmp/wt1");
    ocdb
      .prepare(
        `INSERT INTO session (id, project_id, model, time_created, tokens_input, tokens_output) VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run("sess-opencode", "p1", "claude-sonnet-5", 1000, 50000, 12000);
    ocdb.close();

    withOpenCodeEnv(dbPath, () => {
      const data = getStatsData();
      assert.equal(data.byModel.length, 1);
      assert.equal(data.byModel[0].tokensInput, 50000);
      assert.equal(data.byModel[0].tokensOutput, 12000);
    });
    close();
  });
  console.log("  ✓ getStatsData: tokens carried through to byModel");
});

test("testStatsTokensPerPassChargesReworkOnce", () => {
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
});

test("testStatsTokensPerPassNullWhenNoPass", () => {
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
});

test("testStatsTokensPerPassNullWithoutTokens", () => {
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
});

test("testStatsTokensCountSessionOnce", () => {
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
    const { dbPath, close } = makeOpenCodeDb(dir);
    const ocdb = new Database(dbPath);
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

    withOpenCodeEnv(dbPath, () => {
      const data = getStatsData();
      assert.equal(data.byModel[0].gateCount, 2);
      // Charged once, and cache counts as input (50000 + 7000 + 3000).
      assert.equal(data.byModel[0].tokensInput, 60000);
      assert.equal(data.byModel[0].tokensOutput, 12000);
      assert.equal(data.byPlanMode[0].tokensInput, 60000);
      assert.equal(data.byRegime[0].tokensInput, 60000);
    });
    close();
  });
  console.log(
    "  ✓ getStatsData: a session's tokens are charged once, cache included",
  );
});

// The real Claude Code shape: `input_tokens` holds only the uncached remainder,
// so printing it alone showed 750k in / 64.6M out — a coding agent reading less
// than it wrote, which cannot happen. Cache read/write are input and must be in
// the total; they stay separate in the data because they bill at other rates.
test("testStatsUsageCountsCacheAsInput", () => {
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
});

test("testStatsUsageByModelIdentity", () => {
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
});

test("testStatsRegimeTokensSplitNotDuplicated", () => {
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
});
