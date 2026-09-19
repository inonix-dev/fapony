// src/mcp/tools/mem.ts — mem_find: read-only search over the project's mem log
//
// "writable ≠ readable back" — the write side works from the CLI with no MCP
// (vela: 2,920 rows / 49 days); what was missing is "which rows are about the
// files I am about to touch". Read-only over readMemLog (PLAN-mem-mcp chunk 2).
//
// No default kind filter — chunk 0 chose A: every kind is still live, so
// filtering `synced`/`next`/`claim` by default would be enforcing prose that
// was already retracted.

import { type MemRow, readMemLog, resolveMemDir } from "../../memory.js";
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
