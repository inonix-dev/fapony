import { test } from "bun:test";
// test/session/codex.test.ts — Codex session usage tests

import assert from "node:assert";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readCodexUsage } from "../../src/session/index.js";
import { withCodexFixture, withEnv } from "./helpers.js";

test("testReadCodexUsageNoDir", () => {
  withEnv("FAPONY_CODEX_SESSIONS_DIR", "/nonexistent/codex/sessions", () => {
    const result = readCodexUsage();
    assert.equal(result.session_count, 0);
    assert.equal(result.total_tokens_input, 0);
    console.log("  ✓ readCodexUsage no dir → empty result");
  });
});

test("testReadCodexUsagePrimaryPath", () => {
  withCodexFixture((dir) => {
    withEnv("FAPONY_CODEX_SESSIONS_DIR", dir, () => {
      const result = readCodexUsage("/tmp/test-worktree");
      assert.equal(
        result.session_count,
        2,
        `got ${result.session_count} sessions`,
      );
      assert.equal(result.total_tokens_input, 77216);
      assert.equal(result.total_tokens_output, 770);
      assert.equal(result.total_tokens_reasoning, 179);
      assert.equal(result.total_tokens_cache_read, 50568);
      assert.equal(result.total_tokens_cache_write, 200);
      assert.equal(result.total_cost, 0, "Codex has no cost");
      assert.ok(result.by_model.length >= 1);
      const terra = result.by_model.find((m) => m.model === "gpt-5.6-terra");
      assert.ok(terra, "gpt-5.6-terra found");
      assert.equal(terra!.tokens_input, 77216);
      console.log("  ✓ readCodexUsage primary path → reads JSONL files");
    });
  });
});

test("testReadCodexUsageDetailBytesByTool", () => {
  withCodexFixture((dir) => {
    withEnv("FAPONY_CODEX_SESSIONS_DIR", dir, () => {
      const result = readCodexUsage(
        "/tmp/test-worktree",
        undefined,
        undefined,
        true,
      );
      assert.ok(result.detail, "detail:true must include detail");
      assert.deepEqual(result.detail!.tool_breakdown, {
        exec: 1,
        apply_patch: 1,
      });
      const bbt = result.detail!.bytes_by_tool!;
      assert.ok(bbt, "bytes_by_tool present");
      assert.ok(
        bbt.apply_patch > bbt.exec * 5,
        `expected apply_patch >> exec, got ${JSON.stringify(bbt)}`,
      );
      console.log(
        "  ✓ readCodexUsage detail → tool_breakdown + bytes_by_tool from custom_tool_call pairs",
      );
    });
  });
});

test("testReadCodexUsageFilterByWorktree", () => {
  withCodexFixture((dir) => {
    withEnv("FAPONY_CODEX_SESSIONS_DIR", dir, () => {
      const result = readCodexUsage("/tmp/test-worktree");
      assert.equal(result.session_count, 2);
      const empty = readCodexUsage("/nonexistent/wt");
      assert.equal(empty.session_count, 0);
      console.log("  ✓ readCodexUsage filter by worktree");
    });
  });
});

test("testReadCodexUsageSkipsMalformedLines", () => {
  const dir = mkdtempSync(join(tmpdir(), "fapony-codex-malformed-"));
  const sessionsDir = join(dir, "2026", "09", "09");
  mkdirSync(sessionsDir, { recursive: true });

  const content = [
    "not valid json at all",
    JSON.stringify({
      timestamp: "2026-09-09T10:59:01.413Z",
      type: "session_meta",
      payload: {
        session_id: "test-session",
        cwd: "/tmp/test-worktree",
        model: "gpt-5.6-terra",
      },
    }),
    "{ broken json",
    JSON.stringify({
      timestamp: "2026-09-09T10:59:09.677Z",
      type: "token_usage_record",
      payload: {
        session_id: "test-session",
        usage: {
          input_tokens: 1000,
          output_tokens: 50,
          reasoning_output_tokens: 10,
          cached_input_tokens: 200,
          cache_write_input_tokens: 0,
        },
      },
    }),
    JSON.stringify({ type: "some_other_event" }),
  ].join("\n");

  writeFileSync(join(sessionsDir, "rollout-test.jsonl"), content);

  withEnv("FAPONY_CODEX_SESSIONS_DIR", dir, () => {
    const result = readCodexUsage("/tmp/test-worktree");
    assert.equal(result.session_count, 1, "skips malformed lines");
    assert.equal(result.total_tokens_input, 1000);
    assert.equal(result.total_tokens_output, 50);
    console.log("  ✓ readCodexUsage skips malformed lines");
  });
  rmSync(dir, { recursive: true, force: true });
});
