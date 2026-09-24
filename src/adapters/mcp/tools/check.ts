// src/mcp/tools/check.ts — handoff_check tool

import { blastRadiusForWorktree } from "../../../analyze/index.js";
import type { CheckResult } from "../primitives.js";
import { errorResult, jsonResult, type ToolResult } from "../types.js";

// --- Helpers ---

export function extractMultiField(text: string, field: string): string[] {
  const regex = new RegExp(`${field}:\\s*(.+)`, "i");
  const match = text.match(regex);
  if (!match) return [];

  const firstLine = match[1].trim();
  if (!firstLine || firstLine === "none") return [];

  const result = [firstLine];
  const lines = text.split("\n");
  const startIdx = lines.findIndex((l) => l.trim().startsWith(`${field}:`));

  const FAPONY_FIELDS = [
    "claimed",
    "commits",
    "checks",
    "uncertain",
    "not_done",
  ];

  for (let i = startIdx + 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) break; // empty line ends the field
    if (FAPONY_FIELDS.some((f) => line.startsWith(`${f}:`))) break; // new field
    result.push(line);
  }

  return result;
}

// --- Tool implementation ---

export function toolHandoffCheck(args: Record<string, unknown>): ToolResult {
  const {
    handoff,
    facts,
    auto_generate,
    uncertain,
    not_done,
    checks: checksArg,
    worktree,
  } = args;

  // Track which fields the agent actually reported (vs auto-generated)
  const reported: Record<string, boolean> = {};
  if (typeof uncertain === "string") reported.uncertain = true;
  if (typeof not_done === "string") reported.not_done = true;
  if (typeof checksArg === "string") reported.checks = true;

  // Auto-generate claimed/commits from facts if requested
  let resolvedHandoff = handoff;
  if (auto_generate === true && typeof resolvedHandoff !== "string") {
    if (facts && typeof facts === "object") {
      const f = facts as Record<string, unknown>;
      const commits = Array.isArray(f.commits) ? (f.commits as string[]) : [];
      const headSha =
        commits.length > 0 ? commits[commits.length - 1] : "unknown";
      const commitsStr = commits.length > 0 ? commits.join(" ") : "none";

      const lines = [
        "## HANDOFF",
        `claimed: ${headSha}`,
        `commits: ${commitsStr}`,
      ];

      // Only include uncertain/not_done/checks if agent actually provided them
      if (typeof uncertain === "string") {
        lines.push(`uncertain: ${uncertain}`);
      }
      if (typeof not_done === "string") {
        lines.push(`not_done: ${not_done}`);
      }
      if (typeof checksArg === "string") {
        lines.push(`checks: ${checksArg}`);
      }

      resolvedHandoff = lines.join("\n");
    } else {
      return errorResult("auto_generate requires facts with commits");
    }
  }

  if (typeof resolvedHandoff !== "string") {
    return errorResult(
      "handoff is required as a string (or set auto_generate=true with facts)",
    );
  }

  const checkResults: CheckResult[] = [];

  // 1. has_handoff_block
  const hasBlock = resolvedHandoff.includes("## HANDOFF");
  checkResults.push({
    name: "has_handoff_block",
    pass: hasBlock,
    note: hasBlock ? "" : "no ## HANDOFF block found",
  });

  if (!hasBlock) {
    return jsonResult({
      checks: checkResults,
      summary: { total: 1, passed: 0, failed: 1, needs_human_review: true },
    });
  }

  // Extract claimed
  const claimedMatch = resolvedHandoff.match(/claimed:\s*(.+)/i);
  const claimed = claimedMatch?.[1]?.trim() ?? "";

  // Extract commits
  const commitsMatch = resolvedHandoff.match(/commits:\s*(.+)/i);
  const commitsStr = commitsMatch?.[1]?.trim() ?? "";
  const handoffCommits =
    commitsStr && commitsStr !== "none"
      ? commitsStr.split(/\s+/).filter(Boolean)
      : [];

  // Extract checks
  const checksMatch = resolvedHandoff.match(/checks:\s*(.+)/i);
  const checksField = checksMatch?.[1]?.trim() ?? "";

  // Extract uncertain (multi-line)
  const uncertainLines = extractMultiField(resolvedHandoff, "uncertain");
  const notDoneLines = extractMultiField(resolvedHandoff, "not_done");

  // 2. claimed_matches_commits
  if (claimed && claimed !== "none") {
    const claimedInCommits = handoffCommits.some((c) => claimed.startsWith(c));
    checkResults.push({
      name: "claimed_matches_commits",
      pass: claimedInCommits,
      note: claimedInCommits
        ? `claimed commit ${claimed} found in handoff commits`
        : `claimed commit ${claimed} not found in handoff commits`,
    });
  } else {
    checkResults.push({
      name: "claimed_matches_commits",
      pass: true,
      note: "no claimed commit to verify",
    });
  }

  // 3. uncertain_not_empty — fail if agent didn't report OR reported something
  const hasUncertain = uncertainLines.length > 0;
  const uncertainReported = reported.uncertain === true;
  checkResults.push({
    name: "uncertain_not_empty",
    pass: !hasUncertain && uncertainReported,
    note: hasUncertain
      ? `executor flagged uncertainty: ${uncertainLines.join("; ")}`
      : !uncertainReported
        ? "agent did not report uncertainty (required)"
        : "",
  });

  // 4. not_done_not_empty — fail if agent didn't report OR reported something
  const hasNotDone = notDoneLines.length > 0;
  const notDoneReported = reported.not_done === true;
  checkResults.push({
    name: "not_done_not_empty",
    pass: !hasNotDone && notDoneReported,
    note: hasNotDone
      ? `executor reported incomplete: ${notDoneLines.join("; ")}`
      : !notDoneReported
        ? "agent did not report not_done (required)"
        : "",
  });

  // 5. checks_declared — fail if agent didn't report OR reported empty
  const hasChecks = checksField.length > 0 && checksField !== "none";
  const checksReported = reported.checks === true;
  checkResults.push({
    name: "checks_declared",
    pass: hasChecks && checksReported,
    note: !checksReported
      ? "agent did not report checks (required)"
      : hasChecks
        ? "checks field present"
        : "no checks field in handoff",
  });

  // 6. facts_cross_referenced — only when facts provided
  if (facts && typeof facts === "object") {
    const f = facts as Record<string, unknown>;
    const factCommits = Array.isArray(f.commits) ? (f.commits as string[]) : [];
    if (factCommits.length > 0 && handoffCommits.length > 0) {
      const matchCount = handoffCommits.filter((hc) =>
        factCommits.some((fc) => fc.startsWith(hc) || hc.startsWith(fc)),
      ).length;
      const allMatch = matchCount === handoffCommits.length;
      checkResults.push({
        name: "facts_cross_referenced",
        pass: allMatch,
        note: `${matchCount}/${handoffCommits.length} commits in handoff match git facts`,
      });
    } else {
      checkResults.push({
        name: "facts_cross_referenced",
        pass: true,
        note: "no commits to cross-reference",
      });
    }
  }
  // If no facts provided, the check is skipped entirely (not added to checks[])

  const passed = checkResults.filter((c) => c.pass).length;
  const failed = checkResults.filter((c) => !c.pass).length;

  const out: Record<string, unknown> = {
    checks: checkResults,
    summary: {
      total: checkResults.length,
      passed,
      failed,
      needs_human_review: failed > 0,
    },
  };

  // Blast radius: only when the caller supplies a worktree to graph against.
  // facts.files[] comes from handoff_collect. Never throws — null on failure.
  if (typeof worktree === "string") {
    const changed =
      facts &&
      typeof facts === "object" &&
      Array.isArray((facts as Record<string, unknown>).files)
        ? ((facts as Record<string, unknown>).files as unknown[]).filter(
            (f): f is string => typeof f === "string",
          )
        : [];
    out.blast_radius = blastRadiusForWorktree(worktree, changed);
  }

  return jsonResult(out);
}
