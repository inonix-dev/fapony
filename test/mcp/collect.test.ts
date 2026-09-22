// test/mcp/collect.test.ts — tests for handoff_collect tool

import assert from "node:assert";
import { execSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { toolHandoffCollect } from "../../src/adapters/mcp/tools/collect.js";
import { parseToolResult } from "../../src/adapters/mcp/types.js";
import { withTempRepo } from "./helpers.js";

export function testHandoffCollectMissingArgs(): void {
  const result = toolHandoffCollect({});
  assert.ok(result.isError);
  assert.ok(
    (parseToolResult(result) as { error: string }).error.includes("worktree"),
  );
  console.log("  ✓ handoff_collect missing worktree returns error");
}

export function testHandoffCollectAutoDetectRange(): void {
  withTempRepo((dir) => {
    // Create a second commit
    writeFileSync(join(dir, "b.txt"), "new content\n");
    execSync("git add .", { cwd: dir, stdio: "ignore" });
    execSync("git commit -m 'add b.txt'", { cwd: dir, stdio: "ignore" });

    // Call without base_sha/head_sha — should auto-detect HEAD~1..HEAD
    const result = toolHandoffCollect({ worktree: dir });

    assert.equal(result.isError, undefined);
    const data = parseToolResult(result) as {
      facts: { files_changed: number; commits: string[] };
    };
    assert.equal(data.facts.files_changed, 1);
    assert.equal(data.facts.commits.length, 1);
  });
  console.log(
    "  ✓ handoff_collect auto-detects commit range from recent commits",
  );
}

export function testHandoffCollectValidRepo(): void {
  withTempRepo((dir) => {
    // Create a second commit
    writeFileSync(join(dir, "b.txt"), "new content\n");
    execSync("git add .", { cwd: dir, stdio: "ignore" });
    execSync("git commit -m 'add b.txt'", { cwd: dir, stdio: "ignore" });

    const baseSha = execSync("git rev-parse HEAD~1", {
      cwd: dir,
      encoding: "utf-8",
    }).trim();
    const headSha = execSync("git rev-parse HEAD", {
      cwd: dir,
      encoding: "utf-8",
    }).trim();

    const result = toolHandoffCollect({
      base_sha: baseSha,
      head_sha: headSha,
      worktree: dir,
    });

    assert.equal(result.isError, undefined);
    const data = parseToolResult(result) as {
      facts: { files_changed: number; commits: string[]; branch: string };
      provenance: { verified: boolean; source: string };
    };
    assert.equal(data.facts.files_changed, 1);
    assert.equal(data.facts.commits.length, 1);
    assert.equal(data.provenance.verified, true);
    assert.equal(data.provenance.source, "git_cli");
  });
  console.log("  ✓ handoff_collect returns verified facts from real repo");
}

export function testHandoffCollectGitError(): void {
  // Without base_sha/head_sha on a non-git-dir: auto-detect fails
  const result = toolHandoffCollect({ worktree: "/tmp" });
  assert.ok(result.isError);
  assert.ok(
    (parseToolResult(result) as { error: string }).error.includes(
      "cannot auto-detect",
    ),
  );
  console.log(
    "  ✓ handoff_collect auto-detect fails gracefully on non-git dir",
  );
}

export function testHandoffCollectExplicitRange(): void {
  withTempRepo((dir) => {
    // Create 3 commits
    writeFileSync(join(dir, "a.txt"), "a\n");
    execSync("git add . && git commit -m 'a'", { cwd: dir, stdio: "ignore" });
    writeFileSync(join(dir, "b.txt"), "b\n");
    execSync("git add . && git commit -m 'b'", { cwd: dir, stdio: "ignore" });

    const baseSha = execSync("git rev-parse HEAD~1", {
      cwd: dir,
      encoding: "utf-8",
    }).trim();
    const headSha = execSync("git rev-parse HEAD", {
      cwd: dir,
      encoding: "utf-8",
    }).trim();

    // Explicit range should still work
    const result = toolHandoffCollect({
      base_sha: baseSha,
      head_sha: headSha,
      worktree: dir,
    });

    const data = parseToolResult(result) as {
      facts: { commits: string[] };
    };
    assert.equal(data.facts.commits.length, 1);
  });
  console.log("  ✓ handoff_collect with explicit range still works");
}

export function testHandoffCollectReturnsFiles(): void {
  withTempRepo((dir) => {
    writeFileSync(join(dir, "b.txt"), "new content\n");
    execSync("git add .", { cwd: dir, stdio: "ignore" });
    execSync("git commit -m 'add b.txt'", { cwd: dir, stdio: "ignore" });

    const result = toolHandoffCollect({ worktree: dir });
    assert.equal(result.isError, undefined);
    const data = parseToolResult(result) as {
      facts: { files: string[] };
    };
    assert.ok(Array.isArray(data.facts.files));
    assert.ok(data.facts.files.includes("b.txt"));
  });
  console.log("  ✓ handoff_collect returns files[] for blast radius");
}

export function testHandoffCollectAheadBehind(): void {
  withTempRepo((dir) => {
    // Pin a fake origin/main at the first commit, then diverge by one commit.
    const base = execSync("git rev-parse HEAD", {
      cwd: dir,
      encoding: "utf-8",
    }).trim();
    execSync(`git update-ref refs/remotes/origin/main ${base}`, {
      cwd: dir,
      stdio: "ignore",
    });
    writeFileSync(join(dir, "b.txt"), "new content\n");
    execSync("git add .", { cwd: dir, stdio: "ignore" });
    execSync("git commit -m 'add b.txt'", { cwd: dir, stdio: "ignore" });

    const data = parseToolResult(toolHandoffCollect({ worktree: dir })) as {
      facts: { ahead_behind: { ahead: number; behind: number; ref: string } };
    };
    assert.deepEqual(data.facts.ahead_behind, {
      ahead: 1,
      behind: 0,
      ref: "origin/main",
    });
  });
  console.log("  ✓ handoff_collect reports ahead/behind vs origin/main");
}
