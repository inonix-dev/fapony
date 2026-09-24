// src/analyze/types.ts — shared types for the analyze graph + diagnosis.
//
// Pure types only, no imports — every analyze module depends on this one,
// nothing here depends back (same shape as src/install/types.ts).

export interface ImportGraph {
  /** Relative POSIX paths scanned. */
  files: string[];
  /** file → files it imports. */
  deps: Map<string, Set<string>>;
  /** file → files that import it (reverse). */
  dependents: Map<string, Set<string>>;
  /** Imports that could not be resolved (bare specifier / alias / builtin). */
  /** Imports that may hide a real edge: relative misses, path aliases, bare
   * package names, and files too broken to read. Worth warning about. */
  unresolved: number;
  /** `node:` / `bun:` builtins — never an edge between two project files, so
   * counting them as "unresolved" only inflates the warning. */
  external: number;
  /** Files that only re-export (`export ... from`) — they hide the real importer. */
  barrels: Set<string>;
}

export type FindingKind =
  | "hub-untested"
  | "orphan"
  | "cycle"
  | "changed-untested";

export interface Finding {
  kind: FindingKind;
  file: string;
  /** Human sentence — the thing people read. */
  detail: string;
  /** How to re-check it yourself (file names, cycle path). */
  evidence: string;
}

export interface BlastEntry {
  dependents: number;
  tested: boolean;
  /** Dependents of dependents, transitively (cycle-safe, excludes the file itself). */
  transitive: number;
}
