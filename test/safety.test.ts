import { test } from "bun:test";
import assert from "node:assert";
import { assertSafe } from "../src/safety.js";

test("testAssertSafe", () => {
  const dangerous = [
    ["git", "reset", "--hard", "HEAD~1"],
    ["git", "clean", "-fd"],
    ["git", "clean", "-f"],
    ["git", "checkout", "--", "."],
    ["git", "stash"],
  ];

  for (const cmd of dangerous) {
    try {
      assertSafe(cmd);
      assert.fail(`should have thrown for: ${cmd.join(" ")}`);
    } catch (e) {
      assert(
        (e as Error).message.includes("dangerous"),
        `unexpected error for ${cmd.join(" ")}: ${(e as Error).message}`,
      );
    }
  }

  const safe = [
    ["git", "status"],
    ["git", "diff", "--stat"],
    ["git", "log", "--oneline"],
    ["git", "commit", "-m", "fix: something"],
  ];

  for (const cmd of safe) {
    assertSafe(cmd);
  }

  console.log("  ✓ assertSafe");
});
