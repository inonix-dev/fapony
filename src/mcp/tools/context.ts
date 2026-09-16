// src/mcp/tools/context.ts — project_health_context tool
//
// Single-call pre-edit reflex for any caller: returns the paste-ready "known
// patterns" block built from real run history, keyed by files[] (no raw dump,
// ~15 lines max). `plan-with-pony` is one caller, not the only entry point.
//
// It also surfaces project decisions from the mem log — that read is the only
// I/O here; `buildProjectHealthContext` stays pure and just renders.

import { buildProjectHealthContext } from "../../context/index.js";
import { readRecentMemDecisions } from "../../memory.js";
import { getStatsData } from "../../stats.js";
import type { ToolResult } from "../types.js";

export function toolProjectHealthContext(
  args: Record<string, unknown>,
): ToolResult {
  const worktree =
    typeof args.worktree === "string" && args.worktree
      ? args.worktree
      : undefined;
  const files =
    Array.isArray(args.files) && args.files.length > 0
      ? args.files.filter(
          (f): f is string => typeof f === "string" && f.length > 0,
        )
      : undefined;

  // No worktree (or no log) → no decisions line, block still returns.
  const memDecisions = worktree
    ? readRecentMemDecisions(worktree, 3, files).map((r) => ({
        text: r.text,
        spec: r.spec,
      }))
    : [];

  const block = buildProjectHealthContext(getStatsData(), {
    worktree,
    files,
    memDecisions,
  });
  return { content: [{ type: "text", text: block }] };
}
