// src/mcp/tools/report.ts — verification_report MCP tool
//
// High-level composition: collects facts + handoff check + evidence +
// run metrics + verdict into a single VerificationReport.
// Calls existing primitives — no duplicate parser/conformance logic.

import { blastRadiusForWorktree } from "../../../analyze.js";
import { loadConfig } from "../../../core/config.js";
import { getEvents, getRun, openDb } from "../../../db/store.js";
import { parseGateEventData } from "../../../parse.js";
import { collectEvidence } from "../evidence.js";
import type { CheckResult, VerificationReport } from "../primitives.js";
import {
  computeEvidenceSummary,
  getServerSha,
  renderReportText,
} from "../primitives.js";
import { errorResult, jsonResult, type ToolResult } from "../types.js";
import { resolveWorktreeArg } from "../worktree.js";
import { extractMultiField, toolHandoffCheck } from "./check.js";
import { toolHandoffCollect } from "./collect.js";

// --- Handoff text reader ---

function readHandoffFromEvents(runId: number): string | null {
  const db = openDb();
  try {
    const events = getEvents(db, runId);
    for (let i = events.length - 1; i >= 0; i--) {
      if (events[i].kind !== "handoff") continue;
      try {
        const parsed = JSON.parse(events[i].data ?? "") as {
          missing?: boolean;
        };
        if (!parsed.missing && events[i].data) {
          // Reconstruct handoff text from the parsed data. The executor
          // template mandates uncertain:/not_done: lines always, so empty
          // arrays rebuild as "none" — faithful to what the agent reported.
          const dataStr = events[i].data as string;
          const d = JSON.parse(dataStr) as Record<string, unknown>;
          const lines = ["## HANDOFF"];
          if (d.claimed) lines.push(`claimed: ${d.claimed}`);
          if (d.commits)
            lines.push(
              `commits: ${Array.isArray(d.commits) ? d.commits.join(" ") : d.commits}`,
            );
          if (d.checks) lines.push(`checks: ${d.checks}`);
          lines.push(
            `uncertain: ${d.uncertain && Array.isArray(d.uncertain) && d.uncertain.length ? d.uncertain.join("\n") : "none"}`,
          );
          lines.push(
            `not_done: ${d.not_done && Array.isArray(d.not_done) && d.not_done.length ? d.not_done.join("\n") : "none"}`,
          );
          return lines.join("\n");
        }
      } catch {
        // skip unparseable events
      }
      break;
    }
    return null;
  } finally {
    db.close();
  }
}

// --- Tool implementation ---

export function toolVerificationReport(
  args: Record<string, unknown>,
): ToolResult {
  const {
    run_id,
    worktree,
    base_sha,
    head_sha,
    handoff: handoffArg,
    evidence_commands,
    format,
  } = args;

  // --- Resolve worktree + run ---
  let resolvedWorktree: string | null = null;
  let resolvedRunId: number | null = null;

  if (typeof run_id === "number" && Number.isInteger(run_id)) {
    const db = openDb();
    try {
      const run = getRun(db, run_id);
      if (!run) {
        return errorResult(`run ${run_id} not found`);
      }
      resolvedRunId = run_id;
      // run.worktree may be a key (e.g. "falsify"), an absolute path, or
      // the "mcp-external" sentinel — resolve via shared helper so git
      // commands run in the right directory.
      try {
        resolvedWorktree = resolveWorktreeArg(run.worktree);
      } catch (e) {
        return errorResult((e as Error).message);
      }
    } finally {
      db.close();
    }
  } else if (typeof worktree === "string") {
    resolvedWorktree = worktree;
  } else {
    return errorResult("provide run_id or worktree");
  }

  // --- Git facts ---
  let facts: VerificationReport["facts"] = {
    files_changed: 0,
    lines_changed: 0,
    insertions: 0,
    deletions: 0,
    commits: [],
    branch: "",
    files: [],
    git_error: null,
  };

  if (resolvedWorktree) {
    const collectResult = toolHandoffCollect({
      worktree: resolvedWorktree,
      ...(typeof base_sha === "string" ? { base_sha } : {}),
      ...(typeof head_sha === "string" ? { head_sha } : {}),
    });
    const collectData = JSON.parse(collectResult.content[0].text) as {
      facts?: VerificationReport["facts"];
      error?: unknown;
    };
    if (collectData.facts) {
      facts = {
        files_changed: collectData.facts.files_changed ?? 0,
        lines_changed: collectData.facts.lines_changed ?? 0,
        insertions: collectData.facts.insertions ?? 0,
        deletions: collectData.facts.deletions ?? 0,
        commits: collectData.facts.commits ?? [],
        branch: collectData.facts.branch ?? "",
        files: Array.isArray(collectData.facts.files)
          ? collectData.facts.files.filter(
              (f): f is string => typeof f === "string",
            )
          : [],
        git_error: collectData.facts.git_error ?? null,
      };
    }
    // Don't swallow collection failures: a refused/errored collect leaves
    // zeroed facts, so surface the error instead of reporting "0 files".
    if (
      typeof collectData.error === "string" &&
      collectData.error &&
      !facts.git_error
    ) {
      facts = { ...facts, git_error: collectData.error };
    }
  }

  // --- Handoff checks ---
  let handoffChecks: VerificationReport["handoff_checks"] = null;
  const handoffText =
    typeof handoffArg === "string"
      ? handoffArg
      : resolvedRunId
        ? readHandoffFromEvents(resolvedRunId)
        : null;

  if (handoffText) {
    // Forward caller-supplied uncertain/not_done/checks when present;
    // otherwise a field present in the agent's text counts as reported
    // (content is always read from the text by toolHandoffCheck). This keeps
    // the composed tool exactly as strict as handoff_check on the same text —
    // no hardcoded "none" vouching for fields the caller never supplied.
    const checkArgs: Record<string, unknown> = { handoff: handoffText, facts };
    for (const field of ["uncertain", "not_done", "checks"] as const) {
      const fromCaller = args[field];
      if (typeof fromCaller === "string") {
        checkArgs[field] = fromCaller;
      } else if (new RegExp(`^\\s*${field}:`, "im").test(handoffText)) {
        checkArgs[field] = extractMultiField(handoffText, field)[0] ?? "";
      }
    }
    const checkResult = toolHandoffCheck(checkArgs);
    const checkData = JSON.parse(checkResult.content[0].text) as {
      checks?: unknown[];
      summary?: {
        total: number;
        passed: number;
        failed: number;
        needs_human_review: boolean;
      };
    };
    if (checkData.checks && checkData.summary) {
      handoffChecks = {
        checks: checkData.checks as CheckResult[],
        summary: checkData.summary,
      };
    }
  }

  // --- Evidence ---
  const agentCmds = Array.isArray(evidence_commands)
    ? evidence_commands.filter((c): c is string => typeof c === "string")
    : undefined;
  const evidence = resolvedWorktree
    ? collectEvidence({
        worktree: resolvedWorktree,
        agentCommands: agentCmds,
        files: facts.files ?? [],
        config: loadConfig(),
      })
    : [];
  const evidence_summary = computeEvidenceSummary(evidence);

  // --- Verdict ---
  // Gate events store JSON ({verdict, note, round}), so read the JSON
  // shape directly via parseGateEventData.
  let verdict: VerificationReport["verdict"] = null;
  if (resolvedRunId) {
    const db = openDb();
    try {
      const events = getEvents(db, resolvedRunId);
      for (let i = events.length - 1; i >= 0; i--) {
        if (events[i].kind !== "gate") continue;
        const parsed = parseGateEventData(events[i].data);
        if (parsed) {
          verdict = { grade: parsed.verdict, note: parsed.note };
        }
        break;
      }
    } finally {
      db.close();
    }
  }

  // --- Duration + rounds ---
  let duration_ms: number | null = null;
  let rounds = 0;
  if (resolvedRunId) {
    const db = openDb();
    try {
      const run = getRun(db, resolvedRunId);
      if (run) {
        rounds = run.round;
        const t0 = new Date(`${run.created_at.replace(" ", "T")}Z`).getTime();
        const t1 = new Date(`${run.updated_at.replace(" ", "T")}Z`).getTime();
        duration_ms = t1 - t0;
      }
    } finally {
      db.close();
    }
  }

  // No standalone logging: a report is a read, not a unit of work. A
  // worktree-only call (no run_id) leaves runs/events untouched — opening a
  // row here left orphan runs stuck at running forever and inflated
  // runs.total / byWorktree / project_health_context counts.

  // --- Assemble report ---
  const report: VerificationReport = {
    facts,
    handoff_checks: handoffChecks,
    blast_radius: resolvedWorktree
      ? blastRadiusForWorktree(resolvedWorktree, facts.files ?? [])
      : null,
    evidence,
    evidence_summary,
    verdict,
    duration_ms,
    rounds,
    meta: {
      generated_at: new Date().toISOString(),
      source: "fapony_mcp",
      run_id: resolvedRunId,
      server_sha: getServerSha(),
    },
  };

  // --- Output ---
  if (format === "json") {
    return jsonResult(report);
  }
  return { content: [{ type: "text", text: renderReportText(report) }] };
}
