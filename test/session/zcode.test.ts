import { test } from "bun:test";
// test/session/zcode.test.ts — ZCode session usage tests

import assert from "node:assert";
import { readZcodeUsage } from "../../src/session/index.js";
import { withEnv, withZcodeFixtureDb } from "./helpers.js";

test("testReadZcodeUsageNoDb", () => {
  withEnv("FAPONY_ZCODE_DB", "/nonexistent/zcode/db.sqlite", () => {
    const result = readZcodeUsage();
    assert.equal(result.session_count, 0);
    assert.equal(result.total_tokens_input, 0);
    console.log("  ✓ readZcodeUsage no DB → empty result");
  });
});

test("testReadZcodeUsagePrimaryPath", () => {
  withZcodeFixtureDb((dbPath) => {
    withEnv("FAPONY_ZCODE_DB", dbPath, () => {
      const result = readZcodeUsage();
      assert.equal(
        result.session_count,
        2,
        `got ${result.session_count} sessions`,
      );
      assert.ok(result.total_tokens_input > 0);
      assert.ok(result.by_model.length > 0);
      const sonnet = result.by_model.find((m) => m.model === "claude-sonnet-5");
      assert.ok(sonnet, "claude-sonnet-5 found");
      assert.equal(sonnet!.tokens_input, 2500, "sonnet input tokens");
      console.log("  ✓ readZcodeUsage primary path → reads ZCode DB");
    });
  });
});

test("testReadZcodeUsageDetail", () => {
  withZcodeFixtureDb((dbPath) => {
    withEnv("FAPONY_ZCODE_DB", dbPath, () => {
      const result = readZcodeUsage(undefined, undefined, undefined, true);
      assert.ok(result.detail, "detail present");
      assert.ok(result.detail!.tool_breakdown.Bash >= 0);
      assert.ok(result.detail!.steps >= 0);
      console.log("  ✓ readZcodeUsage detail → tool_breakdown and steps");
    });
  });
});

test("testReadZcodeUsageFilterByWorktree", () => {
  withZcodeFixtureDb((dbPath) => {
    withEnv("FAPONY_ZCODE_DB", dbPath, () => {
      const result = readZcodeUsage("/tmp/zcode-wt");
      assert.equal(result.session_count, 2);
      const empty = readZcodeUsage("/nonexistent/wt");
      assert.equal(empty.session_count, 0);
      console.log("  ✓ readZcodeUsage filter by worktree");
    });
  });
});
