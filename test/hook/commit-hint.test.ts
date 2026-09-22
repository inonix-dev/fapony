import { test } from "bun:test";
import assert from "node:assert";
import { execSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { COMMIT_HINT_MIN_COMMITS, commitHintFor } from "../../src/hook.js";
import { writeTempMemRow } from "./helpers.js";

test("testCommitHintNullForNonCommit", () => {
  assert.strictEqual(
    commitHintFor({ command: "git push origin main", cwd: "/tmp" }),
    null,
    "git push must not trigger the hint",
  );
  assert.strictEqual(
    commitHintFor({ command: "git status", cwd: "/tmp" }),
    null,
    "git status must not trigger the hint",
  );
  assert.strictEqual(
    commitHintFor({ command: "", cwd: "/tmp" }),
    null,
    "empty command must not trigger the hint",
  );
  assert.strictEqual(
    commitHintFor({ command: null, cwd: "/tmp" }),
    null,
    "null command must not trigger the hint",
  );
  console.log("  ✓ commit hint → silent for non-commit bash commands");
});

test("testCommitHintNullOutsideGitRepo", () => {
  const dir = mkdtempSync(join(tmpdir(), "fapony-ch-norepo-"));
  try {
    const hint = commitHintFor({
      command: "git commit -m 'test'",
      cwd: dir,
    });
    assert.strictEqual(hint, null, "outside a git repo must be silent");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  console.log("  ✓ commit hint → silent outside a git repo");
});

test("testCommitHintSilentWithoutMemLog", () => {
  const dir = mkdtempSync(join(tmpdir(), "fapony-ch-"));
  try {
    execSync("git init", { cwd: dir, stdio: "ignore" });
    execSync("git config user.email 'test@test.com'", {
      cwd: dir,
      stdio: "ignore",
    });
    execSync("git config user.name 'Test'", { cwd: dir, stdio: "ignore" });
    writeFileSync(join(dir, "README.md"), "# test\n");
    execSync("git add .", { cwd: dir, stdio: "ignore" });
    execSync('git commit -m "init"', { cwd: dir, stdio: "ignore" });

    const hint = commitHintFor({
      command: "git commit -m 'test'",
      cwd: dir,
    });
    assert.strictEqual(hint, null, "no mem log = no window = silent");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  console.log("  ✓ commit hint → silent with no mem log to window on");
});

test("testCommitHintFiresForCommitsSinceMemRow", () => {
  const dir = mkdtempSync(join(tmpdir(), "fapony-ch-"));
  try {
    execSync("git init", { cwd: dir, stdio: "ignore" });
    execSync("git config user.email 'test@test.com'", {
      cwd: dir,
      stdio: "ignore",
    });
    execSync("git config user.name 'Test'", { cwd: dir, stdio: "ignore" });
    writeFileSync(join(dir, "README.md"), "# test\n");
    execSync("git add .", { cwd: dir, stdio: "ignore" });
    execSync('git commit -m "init"', { cwd: dir, stdio: "ignore" });
    writeTempMemRow(dir, "2020-01-01T00:00:00.000Z");

    const hint = commitHintFor({
      command: "git commit -m 'test'",
      cwd: dir,
    });
    assert.ok(hint, "must nudge for commits newer than the last mem row");
    assert.ok(hint.includes("fapony:"), "hint must be prefixed with fapony:");
    assert.ok(hint.includes("mem add"), "hint must name the mem add command");
    assert.ok(
      hint.includes("since last mem row"),
      "window must read as mem rows, not verdicts",
    );
    assert.doesNotMatch(hint, /verdict/i, "verdict wording must be gone");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  console.log("  ✓ commit hint → fires for commits newer than the mem row");
});

test("testCommitHintSilentWhenMemRowCoversCommits", () => {
  const dir = mkdtempSync(join(tmpdir(), "fapony-ch-"));
  try {
    execSync("git init", { cwd: dir, stdio: "ignore" });
    execSync("git config user.email 'test@test.com'", {
      cwd: dir,
      stdio: "ignore",
    });
    execSync("git config user.name 'Test'", { cwd: dir, stdio: "ignore" });
    writeFileSync(join(dir, "README.md"), "# test\n");
    execSync("git add .", { cwd: dir, stdio: "ignore" });
    execSync('git commit -m "init"', { cwd: dir, stdio: "ignore" });
    writeTempMemRow(dir, new Date(Date.now() + 3600_000).toISOString());

    const hint = commitHintFor({
      command: "git commit -m 'test'",
      cwd: dir,
    });
    assert.strictEqual(
      hint,
      null,
      "must be silent when the mem row covers all commits",
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  console.log("  ✓ commit hint → silent when the mem row covers all commits");
});

test("testCommitHintMinCommitsConstant", () => {
  assert.strictEqual(COMMIT_HINT_MIN_COMMITS, 1);
  console.log("  ✓ commit hint min commits constant is 1");
});
