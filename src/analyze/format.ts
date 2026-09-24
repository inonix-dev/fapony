// src/analyze/format.ts — CLI rendering (plain text only — no ANSI, pipes cleanly).

import type { Finding, ImportGraph } from "./types.js";

export function formatAnalyze(graph: ImportGraph, findings: Finding[]): string {
  let imports = 0;
  for (const s of graph.deps.values()) imports += s.size;
  const lines: string[] = [];
  lines.push(
    `fapony analyze — ${graph.files.length} files scanned (.ts/.tsx/.js/.jsx/.py), ${imports} imports, ${graph.external} builtin, ${graph.unresolved} unresolved`,
  );
  lines.push("");

  if (graph.files.length === 0) {
    // Nothing read is not "healthy" — an unsupported-only repo used to get a clean bill here.
    lines.push(
      "no supported source files found — nothing analyzed (only .ts/.tsx/.js/.jsx/.py are read)",
    );
  } else if (findings.length === 0) {
    lines.push("no findings — structure looks healthy");
  } else {
    for (const f of findings.slice(0, 5)) {
      const icon = f.kind === "orphan" ? "·" : "⚠";
      lines.push(`  ${icon}  ${f.file}`);
      lines.push(`     ${f.detail}`);
      lines.push(`     ${f.evidence}`);
      lines.push("");
    }
    const rest = findings.length - Math.min(findings.length, 5);
    if (rest > 0) lines.push(`… and ${rest} more`);
    lines.push(
      graph.unresolved > 0
        ? `${findings.length} findings. ${graph.unresolved} unresolved imports (path alias / package name) — dependent counts may be lower than reality`
        : `${findings.length} findings.`,
    );
  }
  return lines.join("\n");
}
