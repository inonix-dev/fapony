// src/mcp/tools/stats.ts — fapony_stats tool

import type { Run } from "../../db/index.js";
import { openDb } from "../../db/index.js";
import {
  formatStatsText,
  formatVerdictText,
  getPlanBreakdown,
  getStatsData,
  type PlanBreakdown,
  resolveMaxRounds,
} from "../../stats/index.js";
import { errorResult, jsonResult, type ToolResult } from "../types.js";

export function toolFaponyStats(args: Record<string, unknown>): ToolResult {
  const worktree =
    typeof args.worktree === "string" && args.worktree
      ? args.worktree
      : undefined;
  const data = getStatsData(worktree);

  // group_by: top-N slice from real events (PLAN-project-health-context §2).
  // Worktree-scoped when `worktree` is given, global otherwise.
  const groupBy = args.group_by;
  if (groupBy === "reason_code" || groupBy === "plan" || groupBy === "file") {
    const top =
      typeof args.top === "number" && args.top > 0 ? Math.floor(args.top) : 10;
    if (groupBy === "file") {
      const rows = (
        worktree
          ? data.byFile.filter((f) => f.worktree === worktree)
          : data.byFile
      ).slice(0, top);
      return jsonResult({
        group_by: groupBy,
        worktree: worktree ?? null,
        rows,
      });
    }
    if (groupBy === "reason_code") {
      const rows = (
        worktree
          ? data.byReasonCode.filter((r) => r.worktree === worktree)
          : data.byReasonCode
      ).slice(0, top);
      return jsonResult({
        group_by: groupBy,
        worktree: worktree ?? null,
        rows,
      });
    }
    // plan grouping: recompute from scoped runs when worktree is given,
    // so counts reflect only runs in that worktree (not global counts).
    let rows: PlanBreakdown[];
    if (worktree) {
      const db = openDb();
      try {
        const scopedRuns = db
          .prepare("SELECT * FROM runs WHERE worktree = ? ORDER BY id")
          .all(worktree) as Run[];
        rows = getPlanBreakdown(scopedRuns, resolveMaxRounds()).slice(0, top);
      } finally {
        db.close();
      }
    } else {
      rows = data.byPlan.slice(0, top);
    }
    return jsonResult({ group_by: groupBy, worktree: worktree ?? null, rows });
  }
  if (typeof groupBy !== "undefined") {
    return errorResult(`group_by must be one of: reason_code, plan, file`);
  }

  // mode: "verdict" → Pareto frontier of quality vs tokens/pass
  if (args.mode === "verdict") {
    const regime = typeof args.regime === "string" ? args.regime : undefined;
    return {
      content: [{ type: "text", text: formatVerdictText(data, regime) }],
    };
  }

  // json:true → StatsData ล้วน (SPEC-verdict-stats) — ห้ามแทรก text อื่น
  if (args.json === true) {
    return jsonResult(data);
  }

  // json:false → text เดียวกับ `fapony stats` — same formatter, raw (not JSON-wrapped)
  return { content: [{ type: "text", text: formatStatsText(data) }] };
}
