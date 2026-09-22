import { test } from "bun:test";
// test/mcp/worktree.test.ts — tests for resolveWorktreeArg

import assert from "node:assert";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveWorktreeArg } from "../../src/adapters/mcp/worktree.js";

function withConfig(worktrees: Record<string, string>, fn: () => void): void {
  const oldEnv = process.env.FAPONY_CONFIG;
  const tmpFile = join(
    mkdtempSync(join(tmpdir(), "fapony-worktree-")),
    "fapony.config.json",
  );
  writeFileSync(
    tmpFile,
    JSON.stringify({ worktrees, review: { maxRounds: 2 } }),
  );
  process.env.FAPONY_CONFIG = tmpFile;
  try {
    fn();
  } finally {
    if (oldEnv !== undefined) {
      process.env.FAPONY_CONFIG = oldEnv;
    } else {
      delete process.env.FAPONY_CONFIG;
    }
  }
}

test("testResolveWorktreeArgAbsolutePath", () => {
  withConfig({ vela: "/Users/dev/vela" }, () => {
    // Absolute path passes through unchanged
    assert.equal(resolveWorktreeArg("/Users/dev/vela"), "/Users/dev/vela");
    assert.equal(resolveWorktreeArg("/some/other/path"), "/some/other/path");
  });
  console.log("  ✓ resolveWorktreeArg passes through absolute paths");
});

test("testResolveWorktreeArgKeyLookup", () => {
  withConfig({ vela: "/Users/dev/vela", falsify: "/Users/dev/falsify" }, () => {
    assert.equal(resolveWorktreeArg("vela"), "/Users/dev/vela");
    assert.equal(resolveWorktreeArg("falsify"), "/Users/dev/falsify");
  });
  console.log("  ✓ resolveWorktreeArg resolves config keys to absolute paths");
});

test("testResolveWorktreeArgKeyNotFound", () => {
  withConfig({ vela: "/Users/dev/vela" }, () => {
    assert.throws(
      () => resolveWorktreeArg("unknown"),
      (e: Error) => {
        return (
          e.message.includes("unknown") &&
          e.message.includes("absolute path") &&
          e.message.includes("vela")
        );
      },
    );
  });
  console.log(
    "  ✓ resolveWorktreeArg throws with available keys when key not found",
  );
});

test("testResolveWorktreeArgSentinel", () => {
  withConfig({}, () => {
    // "mcp-external" must pass through even with empty config
    assert.equal(resolveWorktreeArg("mcp-external"), "mcp-external");
  });
  console.log("  ✓ resolveWorktreeArg passes through mcp-external sentinel");
});
