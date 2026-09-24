// src/analyze/barrels.ts — exports seen *through* barrels.
//
// `export * from "./x"` is reported by Bun.Transpiler.scan as an IMPORT edge and
// never as an export, so a barrel file scans as having zero exports. Measured on
// vela 2026-09-18: 211 barrels out of 1,996 source files, and `@innominix/ui`
// alone is imported 462 times — the blind spot hides most of the cross-package
// graph, which is why a wrapper reached through a barrel reads as unused. Named
// re-exports (`export { x } from "./y"`) are already reported correctly; only the
// star form needs this. Cost to close it: 1.9ms on a 17-export barrel. tsc answers
// the same question type-accurately for 2,176ms — see SPEC-convention-debt.md §2.2
// for why that 1,145x is not worth paying here.

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { extractExports } from "../map.js";
import { resolvePythonRelative } from "./python.js";
import { resolveRelative } from "./resolve-ts.js";

export const STAR_REEXPORT_RE =
  /^[ \t]*export\s+\*\s+(?:as\s+[\w$]+\s+)?from\s*["'](\.[^"']+)["']/gm;

// `from .x import *` — the Python shape of a star re-export. Absolute star
// imports can't resolve (same bucket as TS bare specifiers), so only relative.
export const PY_STAR_REEXPORT_RE =
  /^[ \t]*from\s*(\.+)((?:[\w.]*))\s+import\s+\*/gm;

export function exportsThroughBarrels(
  absDir: string,
  rel: string,
  filesSet: Set<string>,
  seen = new Set<string>(),
): string[] {
  if (seen.has(rel)) return []; // barrels re-export each other; stop the cycle
  seen.add(rel);
  let source: string;
  try {
    source = readFileSync(join(absDir, rel), "utf-8");
  } catch {
    return [];
  }
  const out = extractExports(source, undefined, rel)
    .symbols.filter((s) => s.name !== "*")
    .map((s) => s.name);
  STAR_REEXPORT_RE.lastIndex = 0;
  for (const m of source.matchAll(STAR_REEXPORT_RE)) {
    const hit = resolveRelative(rel, m[1], filesSet);
    if (hit) out.push(...exportsThroughBarrels(absDir, hit, filesSet, seen));
  }
  PY_STAR_REEXPORT_RE.lastIndex = 0;
  for (const m of source.matchAll(PY_STAR_REEXPORT_RE)) {
    const hit = resolvePythonRelative(rel, m[1], m[2], filesSet);
    if (hit) out.push(...exportsThroughBarrels(absDir, hit, filesSet, seen));
  }
  return [...new Set(out)];
}
