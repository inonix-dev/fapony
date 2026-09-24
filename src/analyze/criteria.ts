// src/analyze/criteria.ts — "is this file tested?" criteria shared by
// diagnose, blast radius, and review-seed.
//
// Same regex collect.ts has always used for test detection — single source of
// truth now (collect.ts imports isTestFile from here). Do NOT diverge.

import type { ImportGraph } from "./types.js";

// Word-boundary aware: "test"/"spec" match only as whole path segments, not as
// substrings of other words (e.g. testing.ts, contest.ts, vitest/ do NOT match).
export const TEST_PATH_RE =
  /(?:^|[/._-])(?:test|spec)(?:$|[/._-])|__tests__|\.test\.|\.spec\./i;

export function isTestFile(p: string): boolean {
  return TEST_PATH_RE.test(p);
}

// A file whose entire body is `export ... from "..."`. Detected because a test
// importing a barrel is still a test importing everything behind it — without
// this, every module under src/db/index.ts or src/stats.ts reads as untested.
const EXPORT_FROM_RE =
  /export\s+(?:\*|\{[^}]*\}|type\s+\*|type\s+\{[^}]*\})(?:\s+as\s+[\w$]+)?\s+from\s*["'][^"']+["']\s*;?/g;

export function isBarrelSource(content: string, rel?: string): boolean {
  if (rel?.endsWith("__init__.py") || rel?.endsWith("__init__.pyi")) {
    // A Python barrel re-exports instead of defining: every logical line is
    // an import, a from-import, or the `__all__` assignment. Docstrings are
    // stripped first (nearly every `__init__.py` has one); `#` is cut per
    // line, which is safe here because import/`__all__` lines carry no `#`
    // inside strings — only identifiers, dots, commas, and parens.
    const code = content.replace(/"""[\s\S]*?"""|'''[\s\S]*?'''/g, "");
    const logical: string[] = [];
    let buf = "";
    let open = 0;
    const push = () => {
      const t = buf.trim();
      if (t) logical.push(t);
      buf = "";
      open = 0;
    };
    for (const rawLine of code.split("\n")) {
      const line = rawLine.split("#")[0].trim();
      if (!line) continue;
      buf += (buf ? " " : "") + line;
      open +=
        (line.match(/[[(]/g) ?? []).length -
        (line.match(/[\])]/g) ?? []).length;
      if (!line.endsWith("\\") && open <= 0 && !line.endsWith(",")) push();
    }
    push();
    if (logical.length === 0) return false;
    return logical.every((l) =>
      /^(?:import\s+[\w.]+|from\s+\.*[\w.]*\s+import\s+\S|__all__\s*=)/.test(l),
    );
  }
  const code = content
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^[ \t]*\/\/.*$/gm, "");
  if (!/\bexport\b/.test(code)) return false;
  EXPORT_FROM_RE.lastIndex = 0;
  return code.replace(EXPORT_FROM_RE, "").trim() === "";
}

// Is any test file an importer of `file`, walking *through* barrels only?
// Barrels can nest (db/*.ts → db/index.ts → db.ts), so recurse, but never
// through a normal module — that would make every file in a tested repo
// count as tested and kill the signal entirely.
export function isTestedThroughBarrels(
  graph: ImportGraph,
  file: string,
  seen = new Set<string>(),
): boolean {
  if (seen.has(file)) return false;
  seen.add(file);
  for (const dep of graph.dependents.get(file) ?? []) {
    if (isTestFile(dep)) return true;
    if (graph.barrels.has(dep) && isTestedThroughBarrels(graph, dep, seen))
      return true;
  }
  return false;
}
