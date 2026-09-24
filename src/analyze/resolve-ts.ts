// src/analyze/resolve-ts.ts — TS/JS import resolution.
//
// Bun.Transpiler.scan() finds static imports; the two regexes below cover its
// blind spots (require() and `import type` are real edges — changing a type
// still shakes dependents). No overlap with scan output — scan reports
// neither form.

import {
  dirname as posixDirname,
  join as posixJoin,
  normalize as posixNormalize,
} from "node:path/posix";

export const REQUIRE_RE = /\brequire\(\s*["']([^"']+)["']\s*\)/g;
export const IMPORT_TYPE_RE =
  /\bimport\s+type\s+[^;]*?\bfrom\s*["']([^"']+)["']/g;

const RESOLVE_EXTS = [".ts", ".tsx", ".js", ".jsx"];

export function resolveRelative(
  importerRel: string,
  raw: string,
  filesSet: Set<string>,
): string | null {
  const base = posixNormalize(posixJoin(posixDirname(importerRel), raw));
  const candidates = new Set<string>([base, `${base}/index.ts`]);
  for (const e of RESOLVE_EXTS) candidates.add(base + e);
  // TS files import the compiled path ("./foo.js") — try the stem too.
  const dot = base.lastIndexOf(".");
  if (dot > base.lastIndexOf("/")) {
    const stem = base.slice(0, dot);
    for (const e of RESOLVE_EXTS) candidates.add(stem + e);
    candidates.add(`${stem}/index.ts`);
  }
  for (const c of candidates) {
    if (filesSet.has(c)) return c;
  }
  return null;
}
