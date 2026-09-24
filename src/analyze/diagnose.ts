// src/analyze/diagnose.ts — `diagnose()`: hub-untested / orphan / cycle /
// changed-untested findings over a built graph.

import { isTestedThroughBarrels, isTestFile } from "./criteria.js";
import { isEntryPoint } from "./discover.js";
import type { Finding, FindingKind, ImportGraph } from "./types.js";

function findCycles(graph: ImportGraph): string[][] {
  const cycles: string[][] = [];
  const seen = new Set<string>();
  const color = new Map<string, number>(); // 1 = on stack, 2 = done
  const stack: string[] = [];

  function visit(node: string): void {
    if (cycles.length >= 20) return; // bound work, display caps at 5 anyway
    color.set(node, 1);
    stack.push(node);
    for (const next of graph.deps.get(node) ?? []) {
      if (cycles.length >= 20) break;
      const c = color.get(next) ?? 0;
      if (c === 1) {
        const cycle = stack.slice(stack.indexOf(next));
        const key = [...cycle].sort().join("|");
        if (!seen.has(key)) {
          seen.add(key);
          cycles.push(cycle);
        }
      } else if (c === 0) {
        visit(next);
      }
    }
    stack.pop();
    color.set(node, 2);
  }

  for (const f of graph.files) {
    if ((color.get(f) ?? 0) === 0) visit(f);
  }
  return cycles;
}

const KIND_RANK: Record<FindingKind, number> = {
  cycle: 0,
  "hub-untested": 1,
  "changed-untested": 2,
  orphan: 3,
};

export function diagnose(
  graph: ImportGraph,
  changed: string[] = [],
): Finding[] {
  const findings: Finding[] = [];
  const filesSet = new Set(graph.files);

  for (const cycle of findCycles(graph)) {
    findings.push({
      kind: "cycle",
      file: cycle.join(" ↔ "),
      detail: "circular imports — refactoring either side breaks the other",
      evidence: [...cycle, cycle[0]].join(" → "),
    });
  }

  const hubUntested: { file: string; n: number }[] = [];
  for (const f of graph.files) {
    const deps = graph.dependents.get(f) ?? new Set<string>();
    if (deps.size === 0) {
      if (!isEntryPoint(f) && !graph.entries?.has(f) && !isTestFile(f)) {
        findings.push({
          kind: "orphan",
          file: f,
          detail:
            "no one imports it and it is not an entry point — dead code candidate",
          evidence: "0 dependents",
        });
      }
    } else if (deps.size >= 3 && !isTestedThroughBarrels(graph, f)) {
      hubUntested.push({ file: f, n: deps.size });
    }
  }
  hubUntested.sort((a, b) => b.n - a.n || (a.file < b.file ? -1 : 1));
  for (const { file, n } of hubUntested) {
    const deps = [...(graph.dependents.get(file) ?? [])].sort();
    const shown = deps.slice(0, 3).join(", ");
    const rest = n > 3 ? ` … (+${n - 3})` : "";
    findings.push({
      kind: "hub-untested",
      file,
      detail: `${n} files depend on it; no test imports it — edit here and nothing catches the break`,
      evidence: `dependents: ${shown}${rest}`,
    });
  }

  for (const c of changed) {
    if (!filesSet.has(c)) continue;
    const deps = graph.dependents.get(c) ?? new Set<string>();
    if (!isTestedThroughBarrels(graph, c)) {
      findings.push({
        kind: "changed-untested",
        file: c,
        detail: `recently changed but no test depends on it (${deps.size} dependent) — nothing catches it if it breaks`,
        evidence:
          deps.size > 0
            ? `dependents: ${[...deps].sort().join(", ")}`
            : "0 dependents",
      });
    }
  }

  findings.sort((a, b) => KIND_RANK[a.kind] - KIND_RANK[b.kind]);
  return findings;
}
