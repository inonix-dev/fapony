// src/mcp/tools/context.ts — project_health_context tool
//
// Single call, any caller: returns the paste-ready "known patterns" block built
// from real run history, keyed by files[] (no raw dump, ~15 lines max). Not a
// pre-edit reflex — most files have no history (see CLAUDE.md rule 8); it earns
// its call on a file that does. `plan-with-pony` is one caller, not the only one.
//
// It also surfaces project decisions from the mem log — that read is the only
// I/O here; `buildProjectHealthContext` stays pure and just renders.

import { blastRadiusForWorktree } from "../../analyze.js";
import {
  buildProjectHealthContext,
  HUB_DEPENDENTS_MIN,
  type HubEntry,
} from "../../context/index.js";
import { readRecentMemDecisions } from "../../memory.js";
import { getStatsData } from "../../stats/index.js";
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

  // Hub detection needs both worktree (graph root) and files[] (what to map).
  // Same live-graph cost handoff_check already pays; null/unreadable graph →
  // no hub line, never a throw (PLAN-hub-signal §3).
  const hubs: HubEntry[] =
    worktree && files
      ? Object.entries(blastRadiusForWorktree(worktree, files) ?? {})
          .filter(([, b]) => b.dependents >= HUB_DEPENDENTS_MIN)
          .sort((a, b) => b[1].dependents - a[1].dependents)
          .map(([file, b]) => ({
            file,
            dependents: b.dependents,
            tested: b.tested,
            transitive: b.transitive,
          }))
      : [];

  const block = buildProjectHealthContext(getStatsData(), {
    worktree,
    files,
    memDecisions,
    hubs,
  });
  return { content: [{ type: "text", text: block }] };
}
