// src/mcp/tools/mem.ts — mem_find (read) + mem_add (write)
//
// "writable ≠ readable back" — the write side was CLI-only until now; what was
// missing is letting an agent append a mem row mid-session without spawning a
// shell.  files[] is required on the write side: a row that does not name the
// file is unfindable when you touch that file (fill rate 26% CLI-flag vs 88%
// MCP-required — schema wins over prose every time, see CLAUDE.md rule 9).

import { openRows } from "../../../mem/selectors.js";
import {
  initStore,
  KINDS,
  nextId,
  put,
  rows,
  type WorkKind,
} from "../../../mem/store.js";
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
}): MemFindResult {
  const read = readMemLog(args.worktree, args.since);

  let rows = read.rows;
  if (args.kind && args.kind.length > 0) {
    const kinds = new Set(args.kind);
    rows = rows.filter((r) => kinds.has(r.kind));
  }
  if (args.text) {
    const needle = args.text.toLowerCase();
    rows = rows.filter((r) => r.text.toLowerCase().includes(needle));
  }
  if (args.files && args.files.length > 0) {
    // Rows written by `mem add --files` carry files[] — match that first.
    // Older rows (and any row whose author skipped --files) have none, so the
    // text/spec/ref substring stays as the fallback: low recall by nature,
    // a limit of the data rather than of the query (spec §5.4).
    const paths = args.files.map((f) => f.toLowerCase());
    rows = rows.filter((r) => {
      const stored = (r.files ?? []).map((f) => f.toLowerCase());
      if (stored.some((f) => paths.some((p) => f === p || f.endsWith(`/${p}`))))
        return true;
      const hay = `${r.text}\n${r.spec ?? ""}\n${r.ref ?? ""}`.toLowerCase();
      return paths.some((p) => hay.includes(p));
    });
  }

  const total = rows.length;
  const limit = Math.max(0, args.limit ?? 20);
  return {
    rows: rows.slice(0, limit),
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
  const limit = typeof args.limit === "number" ? args.limit : undefined;

  return jsonResult(memFind({ worktree, files, text, kind, since, limit }));
}

// --- mem_add ---

export interface MemAddResult {
  id: string;
  kind: string;
  text: string;
  files: string[];
  spec?: string;
  ts: string;
}

const CAP_NEXT = 15;
const CAP_HOLD = 10;

export function memAdd(args: {
  worktree: string;
  kind: string;
  text: string;
  files: string[];
  spec?: string;
}): MemAddResult {
  if (!KINDS.includes(args.kind as WorkKind)) {
    throw new Error(
      `kind must be one of ${KINDS.join("|")} — got "${args.kind}"`,
    );
  }
  if (args.files.length === 0) {
    throw new Error("files must contain at least one path");
  }
  if (!args.text.trim()) {
    throw new Error("text is required and must not be empty");
  }
  // CLI cmdAdd rejects hold without a spec (write.ts) — keep the two writers
  // in lockstep: without a spec a hold can never be resolved by rotate.
  if (args.kind === "hold" && !args.spec) {
    throw new Error("hold requires a spec — pass spec: <path/to/SPEC.md>");
  }

  initStore(args.worktree);
  const all = rows();

  // Cap check — matches CLI cmdAdd behaviour
  if (args.kind === "next" && !process.env.MEM_FORCE) {
    const openNext = openRows(all).filter((r) => r.kind === "next").length;
    if (openNext >= CAP_NEXT) {
      throw new Error(
        `open next ${openNext}/${CAP_NEXT} is full — close an old one first`,
      );
    }
  }
  if (args.kind === "hold" && !process.env.MEM_FORCE) {
    const openHold = openRows(all).filter((r) => r.kind === "hold").length;
    if (openHold >= CAP_HOLD) {
      throw new Error(
        `open hold ${openHold}/${CAP_HOLD} is full — close/release an old one first`,
      );
    }
  }

  const id = nextId(all);
  const ts = new Date().toISOString();
  put({
    id,
    kind: args.kind as WorkKind,
    text: args.text,
    spec: args.spec,
    files: args.files,
  });

  return {
    id,
    kind: args.kind,
    text: args.text,
    files: args.files,
    spec: args.spec,
    ts,
  };
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

  try {
    const result = memAdd({ worktree, kind, text, files, spec });
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

export interface MemCloseResult {
  ref: string;
  text: string;
  ts: string;
}

export function memClose(args: {
  worktree: string;
  id: string;
  text: string;
}): MemCloseResult {
  if (!args.id.trim()) {
    throw new Error("id is required");
  }
  if (!args.text.trim()) {
    throw new Error("text is required and must not be empty");
  }

  initStore(args.worktree);
  const all = rows();
  if (!all.some((r) => "id" in r && r.id === args.id)) {
    throw new Error(`no id "${args.id}" in the log`);
  }

  const ts = new Date().toISOString();
  put({ kind: "close", ref: args.id, text: args.text });

  return { ref: args.id, text: args.text, ts };
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
