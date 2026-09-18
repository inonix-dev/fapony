// src/mcp/tools/verdict.ts — verdict_submit tool

import {
  findOpenRun,
  findOpenRunWithNullPlan,
  getRun,
  newRun,
  openDb,
  patchLastGateEvent,
} from "../../db/index.js";
import { gateOnce } from "../../gate.js";
import { VERDICT_GRADES, type VerdictGrade } from "../../parse.js";
import {
  errorResult,
  jsonResult,
  REASON_CODES,
  REGIME_CODES,
  type ReasonCode,
  type RegimeCode,
  type ToolResult,
} from "../types.js";
import { resolveWorktreeArg } from "../worktree.js";

// --- Tool implementation ---

export function toolVerdictSubmit(args: Record<string, unknown>): ToolResult {
  const {
    run_id,
    verdict,
    reason_code,
    regime,
    note,
    worktree,
    plan,
    session_id,
    files,
  } = args;

  if (typeof verdict !== "string" || !VERDICT_GRADES.has(verdict)) {
    return errorResult(
      `verdict must be one of: ${[...VERDICT_GRADES].join(", ")}`,
    );
  }
  const grade = verdict as VerdictGrade;
  if (!REASON_CODES.includes(reason_code as ReasonCode)) {
    return errorResult(
      `reason_code must be one of: ${REASON_CODES.join(", ")}`,
    );
  }
  if (reason_code === "other" && (!note || typeof note !== "string")) {
    return errorResult("reason_code 'other' requires a note");
  }
  if (!REGIME_CODES.includes(regime as RegimeCode)) {
    return errorResult(`regime must be one of: ${REGIME_CODES.join(", ")}`);
  }
  const regimeCode = regime as RegimeCode;

  const db = openDb();

  // Resolve or create run_id
  let resolvedRunId: number;
  if (typeof run_id === "number" && Number.isInteger(run_id)) {
    const run = getRun(db, run_id);
    if (!run) {
      return jsonResult({ stored: false, error: "run not found" });
    }
    resolvedRunId = run_id;
  } else {
    // Bind to the latest still-open run for the same worktree+plan so a
    // round-2+ verdict lands on the original row (round keeps counting and
    // review.maxRounds can actually trigger). Only when no open run matches
    // is a fresh row created. plan=null always opens a new run (no guess).
    // Free-text plans are normalized (trim+lowercase) so "Fix Login" and
    // "fix login" bind to the same run. When no exact match exists, falls
    // back to any open run with plan=null (the "no PLAN file" flow).
    const resolvedWorktree =
      typeof worktree === "string" && worktree
        ? resolveWorktreeArg(worktree)
        : "mcp-external";
    const resolvedPlan =
      typeof plan === "string" && plan ? plan.trim().toLowerCase() : null;
    // BEGIN IMMEDIATE makes the find-then-create below atomic across
    // concurrent MCP processes: without it, two agents closing the same
    // worktree+plan at once can both see "no open run" and each insert a
    // row. The write lock taken here blocks (busy_timeout, not throws) the
    // second caller until the first commits, so it re-reads and finds the
    // row already there instead of duplicating it.
    db.run("BEGIN IMMEDIATE");
    try {
      let open = resolvedPlan
        ? findOpenRun(db, resolvedWorktree, resolvedPlan)
        : null;
      // Fallback: if no exact match and plan is non-null, try any open run with
      // plan=null.  This lets a verdict with free-text intent bind to a run that
      // was created without a plan (the common "no PLAN file" flow).
      if (!open && resolvedPlan) {
        open = findOpenRunWithNullPlan(db, resolvedWorktree);
      }
      if (open) {
        resolvedRunId = open.id;
      } else {
        // worktree/plan let callers (e.g. move-to-done) attribute the verdict
        // so byReasonCode/bestPassing aggregate correctly instead of collapsing
        // into "mcp-external".
        resolvedRunId = newRun(db, resolvedWorktree, resolvedPlan, null, "mcp");
      }
      db.run("COMMIT");
    } catch (e) {
      db.run("ROLLBACK");
      throw e;
    }
  }

  // Normalize files: must be a non-empty array of strings.
  const resolvedFiles =
    Array.isArray(files) && files.length > 0
      ? files.filter((f): f is string => typeof f === "string" && f.length > 0)
      : undefined;

  // Route through gateOnce for consistent status/round/memory handling.
  const mcpNote =
    typeof note === "string" && note
      ? `[${reason_code}] ${note}`
      : `[${reason_code}]`;
  const result = gateOnce(resolvedRunId, grade, mcpNote, resolvedFiles);

  if (result.error) {
    return jsonResult({
      stored: false,
      error: result.error,
      run_id: resolvedRunId,
      status: result.status,
      round: result.round,
    });
  }

  // Patch the gate event with MCP-specific fields (reason_code, source).
  // session_id lets gates.ts resolve model from client session logs when the
  // window has no spawn events (the old execute→review loop that wrote spawns
  // is gone). Optional — agents that can't expose it just omit it.
  const patch: Record<string, unknown> = {
    reason_code,
    regime: regimeCode,
    source: "mcp",
  };
  if (typeof session_id === "string" && session_id) {
    patch.session_id = session_id;
  }
  patchLastGateEvent(db, resolvedRunId, patch);

  return jsonResult({
    stored: true,
    run_id: resolvedRunId,
    verdict: grade,
    reason_code,
    regime: regimeCode,
    status: result.status,
    round: result.round,
    ...(resolvedFiles ? { files: resolvedFiles } : {}),
  });
}
