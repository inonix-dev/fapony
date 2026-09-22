// test/mcp/helpers.test.ts — tests for utility functions + e2e pipeline

import assert from "node:assert";
import { execSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { toolHandoffCheck } from "../../src/adapters/mcp/tools/check.js";
import { toolHandoffCollect } from "../../src/adapters/mcp/tools/collect.js";
import {
  errorResult,
  jsonResult,
  parseToolResult,
  REASON_CODES,
  REGIME_CODES,
} from "../../src/adapters/mcp/types.js";
import { withTempRepo } from "./helpers.js";

// --- Utility function tests ---

export function testJsonResult(): void {
  const r = jsonResult({ foo: 1 });
  assert.equal(r.content.length, 1);
  assert.equal(r.content[0].type, "text");
  assert.equal(JSON.parse(r.content[0].text).foo, 1);
  console.log("  ✓ jsonResult wraps data in content");
}

export function testErrorResult(): void {
  const r = errorResult("oops");
  assert.equal(r.isError, true);
  assert.equal(JSON.parse(r.content[0].text).error, "oops");
  console.log("  ✓ errorResult marks isError");
}

export function testParseToolResult(): void {
  const r = jsonResult({ a: 1 });
  assert.deepEqual(parseToolResult(r), { a: 1 });
  console.log("  ✓ parseToolResult round-trips");
}

export function testReasonCodesAreLocked(): void {
  assert.equal(REASON_CODES.length, 9);
  assert.ok(REASON_CODES.includes("missing_test"));
  assert.ok(REASON_CODES.includes("scope_mismatch"));
  assert.ok(REASON_CODES.includes("unsafe_command"));
  assert.ok(REASON_CODES.includes("spec_gap"));
  assert.ok(REASON_CODES.includes("timeout"));
  assert.ok(REASON_CODES.includes("blocked"));
  assert.ok(REASON_CODES.includes("incomplete"));
  assert.ok(REASON_CODES.includes("none"));
  assert.ok(REASON_CODES.includes("other"));
  console.log("  ✓ REASON_CODES has 9 values (locked)");
}

export function testRegimeCodesAreLocked(): void {
  assert.equal(REGIME_CODES.length, 6);
  assert.ok(REGIME_CODES.includes("code"));
  assert.ok(REGIME_CODES.includes("fix"));
  assert.ok(REGIME_CODES.includes("review"));
  assert.ok(REGIME_CODES.includes("plan"));
  assert.ok(REGIME_CODES.includes("inquiry"));
  assert.ok(REGIME_CODES.includes("test"));
  console.log("  ✓ REGIME_CODES has 6 values (locked)");
}

// --- End-to-end pipeline test ---

export function testEndToEndPipeline(): void {
  const oldEnv = process.env.FAPONY_STATE_DIR;
  const tmpDir = mkdtempSync(join(tmpdir(), "fapony-mcp-e2e-"));
  process.env.FAPONY_STATE_DIR = tmpDir;
  try {
    withTempRepo((dir) => {
      // Make a commit
      writeFileSync(join(dir, "feature.ts"), "export const x = 1;\n");
      execSync("git add .", { cwd: dir, stdio: "ignore" });
      execSync("git commit -m 'add feature'", { cwd: dir, stdio: "ignore" });

      const baseSha = execSync("git rev-parse HEAD~1", {
        cwd: dir,
        encoding: "utf-8",
      }).trim();
      const headSha = execSync("git rev-parse HEAD", {
        cwd: dir,
        encoding: "utf-8",
      }).trim();

      // Step 1: collect
      const collectResult = toolHandoffCollect({
        base_sha: baseSha,
        head_sha: headSha,
        worktree: dir,
      });
      const collectData = parseToolResult(collectResult) as {
        facts: { commits: string[] };
      };

      // Step 2: check (agent reports uncertain/not_done/checks)
      const handoff = [
        "## HANDOFF",
        `claimed: ${headSha}`,
        `commits: ${headSha}`,
        "checks: typecheck pass",
        "uncertain: none",
        "not_done: none",
      ].join("\n");
      const checkResult = toolHandoffCheck({
        handoff,
        facts: { commits: collectData.facts.commits },
        uncertain: "none",
        not_done: "none",
        checks: "typecheck pass",
      });
      const checkData = parseToolResult(checkResult) as {
        summary: { failed: number };
      };
      assert.equal(checkData.summary.failed, 0);
    });
  } finally {
    if (oldEnv !== undefined) {
      process.env.FAPONY_STATE_DIR = oldEnv;
    } else {
      delete process.env.FAPONY_STATE_DIR;
    }
  }
  console.log("  ✓ end-to-end pipeline: collect → check");
}
