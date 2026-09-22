// src/mcp/tools/collect.ts — handoff_collect tool

import { execSync } from "node:child_process";
import { isTestFile } from "../../../analyze.js";
import { errorResult, jsonResult, type ToolResult } from "../types.js";

// --- Git helper ---

function execGitSafe(
  cmd: string,
  cwd: string,
): { ok: boolean; output: string; error?: string } {
  try {
    const output = execSync(cmd, {
      cwd,
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
      timeout: 15_000,
    });
    return { ok: true, output: output.trim() };
  } catch (e: unknown) {
    const msg =
      e && typeof e === "object" && ("stderr" in e || "message" in e)
        ? String(
            (e as { stderr?: string; message?: string }).stderr ??
              (e as { message?: string }).message ??
              "unknown",
          )
        : "unknown";
    return { ok: false, output: "", error: msg.trim() };
  }
}

// ahead/behind vs the default remote branch, as of the last fetch — no network here.
// ponytail: origin/main|master only; add upstream/`origin/HEAD` lookup if a repo names it otherwise.
function aheadBehind(
  worktree: string,
): { ahead: number; behind: number; ref: string } | null {
  for (const ref of ["origin/main", "origin/master"]) {
    const r = execGitSafe(
      `git rev-list --left-right --count ${ref}...HEAD`,
      worktree,
    );
    if (!r.ok) continue;
    const [behind, ahead] = r.output.split(/\s+/).map((n) => parseInt(n, 10));
    if (Number.isNaN(behind) || Number.isNaN(ahead)) continue;
    return { ahead, behind, ref };
  }
  return null;
}

// --- Tool implementation ---

export function toolHandoffCollect(args: Record<string, unknown>): ToolResult {
  const { base_sha, head_sha, worktree } = args;

  if (typeof worktree !== "string") {
    return errorResult("worktree is required as a string");
  }

  // Auto-detect commit range if not provided
  let resolvedBaseSha = base_sha;
  let resolvedHeadSha = head_sha;

  if (typeof resolvedBaseSha !== "string") {
    const detected = execGitSafe("git rev-parse HEAD~1", worktree);
    if (!detected.ok) {
      return errorResult(
        `cannot auto-detect base_sha: ${detected.error}. Provide base_sha explicitly.`,
      );
    }
    resolvedBaseSha = detected.output;
  }

  if (typeof resolvedHeadSha !== "string") {
    const detected = execGitSafe("git rev-parse HEAD", worktree);
    if (!detected.ok) {
      return errorResult(
        `cannot auto-detect head_sha: ${detected.error}. Provide head_sha explicitly.`,
      );
    }
    resolvedHeadSha = detected.output;
  }

  // Diff stat
  let files_changed = 0;
  let lines_changed = 0;
  let insertions = 0;
  let deletions = 0;
  let gitError: string | undefined;

  const diffResult = execGitSafe(
    `git diff --stat ${resolvedBaseSha}..${resolvedHeadSha} -- .`,
    worktree,
  );

  if (diffResult.ok) {
    const fileMatch = diffResult.output.match(/(\d+) files? changed/);
    files_changed = fileMatch ? parseInt(fileMatch[1], 10) : 0;
    const insMatch = diffResult.output.match(/(\d+) insertions?\(\+\)/);
    const delMatch = diffResult.output.match(/(\d+) deletions?\(-\)/);
    insertions = insMatch ? parseInt(insMatch[1], 10) : 0;
    deletions = delMatch ? parseInt(delMatch[1], 10) : 0;
    lines_changed = insertions + deletions;
  } else {
    gitError = `git diff failed: ${diffResult.error}`;
  }

  // Commits
  const logResult = execGitSafe(
    `git log --oneline ${resolvedBaseSha}..${resolvedHeadSha}`,
    worktree,
  );
  const commits = logResult.ok
    ? logResult.output
        .split("\n")
        .filter(Boolean)
        .map((l) => l.split(" ")[0])
    : [];

  // Branch
  const branchResult = execGitSafe("git branch --show-current", worktree);
  const branch = branchResult.ok ? branchResult.output : "";

  // Check file types
  const nameResult = execGitSafe(
    `git diff --name-only ${resolvedBaseSha}..${resolvedHeadSha}`,
    worktree,
  );
  const names = nameResult.ok
    ? nameResult.output.split("\n").filter(Boolean)
    : [];
  const has_test_changes = names.some((n) => isTestFile(n));
  const has_docs_changes = names.some((n) => /\.md$/i.test(n));

  return jsonResult({
    facts: {
      files_changed,
      lines_changed,
      insertions,
      deletions,
      commits,
      branch,
      files: names,
      ahead_behind: aheadBehind(worktree),
      git_error: gitError ?? null,
    },
    checks: {
      has_test_changes,
      has_docs_changes,
    },
    provenance: {
      verified: true,
      source: "git_cli",
    },
  });
}
