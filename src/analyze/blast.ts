// src/analyze/blast.ts — `blastRadius()`: per-file { dependents, tested }
// facts for handoff_check / verification_report.

import { isTestedThroughBarrels } from "./criteria.js";
import { buildGraph } from "./graph.js";
import type { BlastEntry, ImportGraph } from "./types.js";

// BFS over the reverse-edge map — one grep-and-recurse chain collapsed into
// one walk. `seen` makes cycles a no-op instead of an infinite loop.
function transitiveDependentsCount(graph: ImportGraph, file: string): number {
  const seen = new Set<string>();
  let frontier = graph.dependents.get(file) ?? new Set<string>();
  while (frontier.size > 0) {
    const next = new Set<string>();
    for (const f of frontier) {
      if (seen.has(f)) continue;
      seen.add(f);
      for (const dep of graph.dependents.get(f) ?? []) {
        if (!seen.has(dep)) next.add(dep);
      }
    }
    frontier = next;
  }
  // A cycle can walk back to `file` itself — it's not its own dependent.
  seen.delete(file);
  return seen.size;
}

export function blastRadius(
  graph: ImportGraph,
  files: string[],
): Record<string, BlastEntry> {
  const out: Record<string, BlastEntry> = {};
  for (const f of files) {
    const deps = graph.dependents.get(f) ?? new Set<string>();
    out[f] = {
      dependents: deps.size,
      tested: isTestedThroughBarrels(graph, f),
      transitive: transitiveDependentsCount(graph, f),
    };
  }
  return out;
}

// Convenience for the MCP tools: graph the worktree live, map files[] to
// blast radius. Null when there is nothing to map or the dir is unreadable —
// callers render "no blast data", never throw.
export function blastRadiusForWorktree(
  worktree: string,
  files: string[],
): Record<string, BlastEntry> | null {
  if (files.length === 0) return null;
  try {
    return blastRadius(buildGraph(worktree), files);
  } catch {
    return null;
  }
}
