// src/mcp/tools/mem.ts — mem_find (read) + mem_add (write)
//
// "writable ≠ readable back" — the write side was CLI-only until now; what was
// missing is letting an agent append a mem row mid-session without spawning a
// shell.  files[] is required on the write side: a row that does not name the
// file is unfindable when you touch that file (fill rate 26% CLI-flag vs 88%
// MCP-required — schema wins over prose every time, see CLAUDE.md rule 9).

import {
  type EngineAddResult,
  type EngineCloseResult,
  engineAdd,
  engineClose,
  engineFind,
} from "../../../mem/engine.js";
import { initStore, KINDS, type WorkKind } from "../../../mem/store.js";
import { type MemRow, readMemLog, resolveMemDir } from "../../../memory.js";
import { errorResult, jsonResult, type ToolResult } from "../types.js";

export interface MemFindResult {
  rows: MemRow[];
  total: number;
  filesFound: number;
  skipped: number;
  memDir: string | null;
}

export function memFind(args: {
  worktree: string;
  files?: string[];
  text?: string;
  kind?: string[];
  since?: string;
  limit?: number;
  open?: boolean;
}): MemFindResult {
  // Query logic lives in the shared engine (src/mem/engine.ts) — this wrapper
  // owns only the read (readMemLog sees live + rotated archives via its loose
  // log*.jsonl regex) and the result shape. No kind default here by contract:
  // omitting kind returns every kind (locked by test). CLI cmdFind calls the
  // same engine with its own bookkeeping exclude.
  const read = readMemLog(args.worktree);
  const { rows: matched, total } = engineFind(read.rows, {
    text: args.text,
    files: args.files,
    kind: args.kind,
    sinceIso: args.since,
    limit: args.limit,
    open: args.open,
  });
  return {
    rows: matched,
    total,
    filesFound: read.filesFound,
    skipped: read.skipped,
    // memDir separates "no mem at all" from "nothing matched" (spec §3) and
    // makes the monorepo single-log limit visible (spec §5.1).
    memDir: resolveMemDir(args.worktree),
  };
}

export function toolMemFind(args: Record<string, unknown>): ToolResult {
  const worktree =
    typeof args.worktree === "string" ? args.worktree.trim() : "";
  if (!worktree) {
    return errorResult(
      "worktree is required and must be an absolute path " +
        "(git rev-parse --show-toplevel) — an empty result without it would be " +
        "misread as 'no history'",
    );
  }
  if (!worktree.startsWith("/")) {
    return errorResult(
      `worktree must be an absolute path, got: ${worktree} — a bare name scopes to nothing`,
    );
  }
  const files = Array.isArray(args.files)
    ? args.files.filter(
        (f): f is string => typeof f === "string" && f.length > 0,
      )
    : undefined;
  const kind = Array.isArray(args.kind)
    ? args.kind.filter(
        (k): k is string => typeof k === "string" && k.length > 0,
      )
    : undefined;
  const text = typeof args.text === "string" ? args.text : undefined;
  const since = typeof args.since === "string" ? args.since : undefined;
  if (since !== undefined && Number.isNaN(Date.parse(since))) {
    return errorResult(
      `since must be an ISO date (e.g. 2026-09-19T00:00:00.000Z), got: "${since}" — CLI accepts <N>d/YYYY-MM-DD, MCP takes ISO only`,
    );
  }
  const limit = typeof args.limit === "number" ? args.limit : undefined;
  const open = typeof args.open === "boolean" ? args.open : undefined;

  return jsonResult(
    memFind({ worktree, files, text, kind, since, limit, open }),
  );
}

// --- mem_add ---
//
// Domain rules live in the shared engine (src/mem/engine.ts) — this wrapper
// owns only store init for its worktree. CLI cmdAdd calls the same engine.

export type MemAddResult = EngineAddResult;

export function memAdd(args: {
  worktree: string;
  kind: string;
  text: string;
  files: string[];
  spec?: string;
  key?: string;
}): MemAddResult {
  initStore(args.worktree);
  return engineAdd({
    kind: args.kind,
    text: args.text,
    files: args.files,
    spec: args.spec,
    key: args.key,
  });
}

export function toolMemAdd(args: Record<string, unknown>): ToolResult {
  const worktree =
    typeof args.worktree === "string" ? args.worktree.trim() : "";
  if (!worktree) {
    return errorResult(
      "worktree is required and must be an absolute path " +
        "(git rev-parse --show-toplevel)",
    );
  }
  if (!worktree.startsWith("/")) {
    return errorResult(`worktree must be an absolute path, got: ${worktree}`);
  }

  const kind = typeof args.kind === "string" ? args.kind.trim() : "";
  if (!kind) {
    return errorResult(`kind is required — one of ${KINDS.join("|")}`);
  }
  if (!KINDS.includes(kind as WorkKind)) {
    return errorResult(
      `kind must be one of ${KINDS.join("|")} — got "${kind}"`,
    );
  }

  const text = typeof args.text === "string" ? args.text.trim() : "";
  if (!text) {
    return errorResult("text is required and must not be empty");
  }

  const files = Array.isArray(args.files)
    ? args.files
        .filter((f): f is string => typeof f === "string" && f.length > 0)
        .map((f) => f.trim().replace(/^\.\//, ""))
    : [];
  if (files.length === 0) {
    return errorResult(
      "files is required and must contain at least one repo-relative path",
    );
  }

  const spec =
    typeof args.spec === "string" && args.spec.trim().endsWith(".md")
      ? args.spec.trim()
      : undefined;

  // Shape gate here, pattern check in engineAdd — a non-string key must not
  // slip through as undefined (silent drop = reject-without-saying, SPEC §Validation).
  if (args.key !== undefined && typeof args.key !== "string") {
    return errorResult(
      'key must be a string matching [a-z0-9-]{3,40} — e.g. "fix-stop-dedupe"',
    );
  }
  const key = typeof args.key === "string" ? args.key : undefined;

  try {
    const result = memAdd({ worktree, kind, text, files, spec, key });
    return jsonResult(result);
  } catch (e) {
    return errorResult(e instanceof Error ? e.message : String(e));
  }
}

// --- mem_close ---
//
// A separate tool on purpose, not kind:"close" inside mem_add: a close row
// carries {ref, text} with no files[] and no spec, while mem_add requires a
// non-empty files[] (and a spec for hold) — folding them into one schema
// would make required fields depend on the value of another field, the shape
// models call wrong most often. Mirrors CLI `mem close <id> "<msg>"`
// (commands/write.ts cmdClose): the id must exist; the tombstone voids the
// claim by itself.

export type MemCloseResult = EngineCloseResult;

export function memClose(args: {
  worktree: string;
  id: string;
  text: string;
}): MemCloseResult {
  initStore(args.worktree);
  return engineClose({ id: args.id, text: args.text });
}

export function toolMemClose(args: Record<string, unknown>): ToolResult {
  const worktree =
    typeof args.worktree === "string" ? args.worktree.trim() : "";
  if (!worktree) {
    return errorResult(
      "worktree is required and must be an absolute path " +
        "(git rev-parse --show-toplevel)",
    );
  }
  if (!worktree.startsWith("/")) {
    return errorResult(`worktree must be an absolute path, got: ${worktree}`);
  }

  const id = typeof args.id === "string" ? args.id.trim() : "";
  if (!id) {
    return errorResult("id is required — the row id to close");
  }

  const text = typeof args.text === "string" ? args.text.trim() : "";
  if (!text) {
    return errorResult("text is required and must not be empty");
  }

  try {
    const result = memClose({ worktree, id, text });
    return jsonResult(result);
  } catch (e) {
    return errorResult(e instanceof Error ? e.message : String(e));
  }
}
