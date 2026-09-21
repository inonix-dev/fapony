// Replacement values are inserted via a function so `$&`, `$'` etc. in the
// value are treated as literal text, not replace() special patterns.
export function templateArgs(
  arr: string[],
  vars: Record<string, string>,
): string[] {
  return arr.map((s) => {
    let out = s;
    for (const [k, v] of Object.entries(vars)) {
      out = out.replaceAll(`{${k}}`, () => v);
    }
    return out;
  });
}

/** Fill a prompt template with {{VARS}} (all occurrences). Missing vars → "". */
export function fillPrompt(
  template: string,
  vars: Record<string, string>,
): string {
  let out = template;
  for (const [k, v] of Object.entries(vars)) {
    out = out.replaceAll(`{{${k}}}`, () => v);
  }
  return out;
}

/** Minutes between two ISO-like timestamps (space separator, UTC assumed). */
export function minutesBetween(a: string, b: string): number {
  const t0 = new Date(`${a.replace(" ", "T")}Z`).getTime();
  const t1 = new Date(`${b.replace(" ", "T")}Z`).getTime();
  return (t1 - t0) / 60000;
}

/** Arithmetic mean of a numeric array. 0 for empty arrays. */
export function avg(xs: number[]): number {
  return xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : 0;
}

/** True for "y"/"yes" (case-insensitive, trimmed) — the only affirmative answers. */
export function isAffirmative(answer: string): boolean {
  const normalized = answer.trim().toLowerCase();
  return normalized === "y" || normalized === "yes";
}

// --- Recursive directory walker ---

import { readdirSync } from "node:fs";
import { join } from "node:path";

export interface WalkDirOpts {
  /** Max recursion depth (default 4). */
  depth?: number;
  /** Skip node_modules (default true). */
  skipNodeModules?: boolean;
  /** Dot-directories to descend into (default []). Others starting with . are skipped. */
  includeDotDirs?: string[];
  /** Extra filter: return true to collect this dir. Omit to collect all reached dirs. */
  predicate?: (dirPath: string) => boolean;
}

/**
 * Recursively walk directories under `root`.
 * Returns absolute paths of dirs for which `predicate` returned true (or all
 * reached dirs when no predicate is given). Skips node_modules by default.
 */
export function walkDir(root: string, opts?: WalkDirOpts): string[] {
  const maxDepth = opts?.depth ?? 4;
  const skipNm = opts?.skipNodeModules ?? true;
  const includeDot = new Set(opts?.includeDotDirs ?? []);
  const pred = opts?.predicate;
  const result: string[] = [];

  const walk = (dir: string, depth: number): void => {
    if (depth > maxDepth) return;
    if (!pred || pred(dir)) result.push(dir);
    try {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        if (!entry.isDirectory()) continue;
        if (entry.isSymbolicLink()) continue;
        if (skipNm && entry.name === "node_modules") continue;
        if (entry.name.startsWith(".") && !includeDot.has(entry.name)) {
          continue;
        }
        walk(join(dir, entry.name), depth + 1);
      }
    } catch {
      // ignore unreadable dirs
    }
  };
  walk(root, 0);
  return result;
}
