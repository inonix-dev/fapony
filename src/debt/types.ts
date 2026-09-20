// src/debt/types.ts — shared types + caps for `fapony debt`.
//
// One convention = pattern to use (ok) + pattern meaning not-yet-migrated
// (stale) + scope (where) + file condition (guard). Iron rule: checker not
// null = fapony never reports that debt item — reporting twice with eslint
// is an abstraction with one implementation (rule 1).

export interface Convention {
  id: string;
  rule: string;
  /** Repo-relative dir scope ("." = whole repo). */
  where: string;
  /** Regex source: a match means the file still has the debt. null = not derivable (checker rows) or not filled in yet. */
  stale: string | null;
  /** Regex source: files that already moved (informational count). */
  ok?: string;
  /** Regex source a file must ALSO match to be in scope (e.g. "extends Base"). */
  guard?: string;
  /** Non-null = a checker (eslint rule / script) exists → fapony never reports this debt. */
  checker?: string | null;
  /** Human answered "no checker" on the promotion question — never ask again. */
  decided?: "no-checker" | null;
}

export interface LoadedConventions {
  path: string | null;
  convs: Convention[];
  /** Rows kept for display but not scannable, plus invalid rows — said out loud, never silent. */
  warnings: string[];
}

export interface DebtEntry {
  conv: Convention;
  /** Files with the debt (stale match), sorted. */
  files: string[];
  /** Files that already moved (ok match) — null when ok is not set. */
  movedCount: number | null;
}

export interface DebtReport {
  worktree: string;
  scannedFiles: number;
  ms: number;
  /** Scannable conventions with their debt list (checker rows never land here). */
  entries: DebtEntry[];
  /** Declared but not fillable by fapony: checker null + no stale — the human/agent fills `stale`. */
  declared: Convention[];
  /** Skipped-with-reason: checker rows are silent by design (not dropped), these are real drops. */
  dropped: { id: string; reason: string }[];
  /** Silent-by-design count: checker non-null — reported as a number, not a list. */
  checkedCount: number;
}

export interface Promotion {
  convId: string;
  rule: string;
  occurrences: number;
  dates: string[];
  debtCount: number;
}

// A stale regex matching more than this many files is not a convention — it is
// a broken/wide regex (stale="e" would flag the repo). SPEC §6: drop the entry
// and say so, never report 600 files.
export const DEBT_FILE_CAP = 250;

export const PROMOTION_THRESHOLD = 3;
export const PROMOTION_MAX = 3;
/** Identifiers shorter than this are too generic to match prose on ("throw", "Error"). */
export const WORD_MIN = 6;

// Zone grouping: a zone is a file's *directory*, capped at this many leading
// segments — never a fixed-depth prefix of the path (which would cut into the
// filename) and never the filename itself. SPEC §4 shows zones at depth 5
// (`apps/mdl/src/server/services`) and depth 3 (`packages/cache/src`) in the
// same report, so the cap must follow the directory, not a constant.
export const ZONE_DEPTH = 5;
// Default cap on zones shown per convention — more than this is a wall, not an answer.
export const ZONE_CAP = 6;
