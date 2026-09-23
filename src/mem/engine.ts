// src/mem/engine.ts — the single validation+write engine for mem add/close.
//
// Both entry points call it: CLI (commands/write.ts cmdAdd/cmdClose) and MCP
// (adapters/mcp/tools/mem.ts memAdd/memClose). Every domain rule lives here
// exactly once — kind check, files[] required, hold-requires-spec, open
// next/hold caps. Wrappers own only their surface: argv parsing +
// console.error/exit (CLI), worktree-shape checks + JSON results (MCP).
//
// Precondition: the store is initialized (initStore) before calling — cli.ts
// does it at dispatch, the MCP wrapper does it per call with its worktree.
// (PLAN-unify-mem-engine chunk 1)

import { KEY_RE } from "../core/mem-log.js";
import { openRows } from "./selectors.js";
import { KINDS, nextId, put, rows, type WorkKind } from "./store.js";

export const CAP_NEXT = 15;
export const CAP_HOLD = 10;

/**
 * Thrown when an open next/hold cap is full. Carries which cap so the CLI
 * wrapper can append its MEM_FORCE hint while MCP passes the bare message
 * (the two surfaces keep their exact legacy strings — PLAN §4).
 */
export class CapError extends Error {
  readonly cap: "next" | "hold";
  constructor(cap: "next" | "hold", message: string) {
    super(message);
    this.name = "CapError";
    this.cap = cap;
  }
}

export interface EngineAddArgs {
  kind: string;
  text: string;
  files: string[];
  spec?: string;
  /** Problem identity — optional, but validated against KEY_RE whenever present. */
  key?: string;
}

export interface EngineAddResult {
  id: string;
  kind: string;
  text: string;
  files: string[];
  spec?: string;
  key?: string;
  ts: string;
}

export function engineAdd(a: EngineAddArgs): EngineAddResult {
  if (!KINDS.includes(a.kind as WorkKind)) {
    throw new Error(`kind must be one of ${KINDS.join("|")} — got "${a.kind}"`);
  }
  if (a.files.length === 0) {
    throw new Error("files must contain at least one path");
  }
  if (!a.text.trim()) {
    throw new Error("text is required and must not be empty");
  }
  // Without a spec a hold can never be resolved by rotate — reject at write.
  if (a.kind === "hold" && !a.spec) {
    throw new Error("hold requires a spec — pass spec: <path/to/SPEC.md>");
  }
  // One validator for both surfaces (CLI argv reaches here too) — reject loudly
  // with a usable example, never silently drop the key (SPEC-mem-keys §Validation).
  if (a.key !== undefined && !KEY_RE.test(a.key)) {
    throw new Error(
      `key must match [a-z0-9-]{3,40} — e.g. "fix-stop-dedupe", got "${a.key}"`,
    );
  }

  const all = rows();
  if (a.kind === "next" && !process.env.MEM_FORCE) {
    const openNext = openRows(all).filter((r) => r.kind === "next").length;
    if (openNext >= CAP_NEXT) {
      throw new CapError(
        "next",
        `open next ${openNext}/${CAP_NEXT} is full — close an old one first`,
      );
    }
  }
  if (a.kind === "hold" && !process.env.MEM_FORCE) {
    const openHold = openRows(all).filter((r) => r.kind === "hold").length;
    if (openHold >= CAP_HOLD) {
      throw new CapError(
        "hold",
        `open hold ${openHold}/${CAP_HOLD} is full — close/release an old one first`,
      );
    }
  }

  const id = nextId(all);
  const ts = new Date().toISOString();
  // Every row written from here on is v:2 — key optional, but the version
  // stamps the schema so a reader can tell new rows from v:1 legacy ones.
  // JSON.stringify drops the undefined key, so keyless rows carry only v.
  put({
    id,
    kind: a.kind as WorkKind,
    text: a.text,
    spec: a.spec,
    files: a.files,
    key: a.key,
    v: 2,
  });
  return {
    id,
    kind: a.kind,
    text: a.text,
    files: a.files,
    spec: a.spec,
    key: a.key,
    ts,
  };
}

export interface EngineCloseArgs {
  id: string;
  text: string;
}

export interface EngineCloseResult {
  ref: string;
  text: string;
  ts: string;
}

export function engineClose(a: EngineCloseArgs): EngineCloseResult {
  if (!a.id.trim()) {
    throw new Error("id is required");
  }
  if (!a.text.trim()) {
    throw new Error("text is required and must not be empty");
  }

  const all = rows();
  if (!all.some((r) => "id" in r && r.id === a.id)) {
    throw new Error(`no id "${a.id}" in the log`);
  }

  const ts = new Date().toISOString();
  put({ kind: "close", ref: a.id, text: a.text });

  return { ref: a.id, text: a.text, ts };
}

// --- find ---
//
// The single query engine for mem find. Both entry points call it with rows
// they already read — CLI (commands/read.ts cmdFind, via allRows() which
// includes rotated archives) and MCP (adapters/mcp/tools/mem.ts memFind, via
// readMemLog whose loose log*.jsonl regex includes log.YYYY-MM-DD.jsonl too).
// Archive scope is therefore identical on both sides with no parameter for it
// (PLAN-unify-mem-engine chunk 2 §4.1: the "MCP reads live only" premise was
// wrong — both see archives, base rate 0 archive files vs 211 live rows).
//
// The engine is pure: it takes rows + typed params, never touches argv
// strings or the store. Wrappers own their surface — CLI parses
// --kind/--files/--since/--limit/--open at the argv layer, MCP validates its JSON
// shape — and each passes its own kind default (PLAN §5 escape):
// MCP passes no exclude (contract: "every kind, no default filter", locked by
// test), CLI passes the bookkeeping exclude to keep its legacy output.

export const FIND_DEFAULT_LIMIT = 20;

/** Bookkeeping rows the CLI hides unless explicitly asked via --kind. */
export const CLI_FIND_EXCLUDE = ["close", "synced", "claim", "release"];

export interface EngineFindArgs {
  /** Substring over text/spec/ref, case-insensitive. Omit = no text filter. */
  text?: string;
  /** Repo-relative paths — stored files[] first, text/spec/ref fallback. */
  files?: string[];
  /** Include filter — when non-empty, wins over excludeKind. */
  kind?: string[];
  /** Exclude filter — applied only when kind is empty. */
  excludeKind?: string[];
  /** ISO timestamp — only rows at or after this time (inclusive). */
  sinceIso?: string;
  /** Max rows returned (total still counts all matches). Default 20. */
  limit?: number;
  /**
   * true = unresolved work only: drops bookkeeping kinds
   * (close/claim/release/synced) plus work rows a close row points at.
   * Mirrors selectors.openRows but stays generic (no store types) so MCP rows
   * qualify. Default false — recall shows closed rows too.
   */
  open?: boolean;
}

export interface EngineFindResult<T> {
  rows: T[];
  total: number;
}

export type FindableRow = {
  kind: string;
  text?: string;
  spec?: string;
  ref?: string;
  files?: string[];
  ts: string;
};

export function engineFind<T extends FindableRow>(
  all: T[],
  a: EngineFindArgs,
): EngineFindResult<T> {
  let out = [...all];

  if (a.open === true) {
    const dead = new Set(
      all
        .filter((r) => r.kind === "close" && typeof r.ref === "string")
        .map((r) => r.ref as string),
    );
    const BOOKKEEPING = new Set(["close", "claim", "release", "synced"]);
    out = out.filter(
      (r) =>
        !BOOKKEEPING.has(r.kind) &&
        !("id" in r && typeof r.id === "string" && dead.has(r.id)),
    );
  }

  if (a.sinceIso) {
    const since = a.sinceIso;
    out = out.filter((r) => !(r.ts < since));
  }

  if (a.kind && a.kind.length > 0) {
    const keep = new Set(a.kind);
    out = out.filter((r) => keep.has(r.kind));
  } else if (a.excludeKind && a.excludeKind.length > 0) {
    const drop = new Set(a.excludeKind);
    out = out.filter((r) => !drop.has(r.kind));
  }

  if (a.text?.trim()) {
    const needle = a.text.toLowerCase();
    out = out.filter((r) =>
      `${r.text ?? ""}\n${r.spec ?? ""}\n${r.ref ?? ""}`
        .toLowerCase()
        .includes(needle),
    );
  }

  if (a.files && a.files.length > 0) {
    // Rows written by `mem add --files` carry files[] — match that first.
    // Older rows (and any row whose author skipped --files) have none, so the
    // text/spec/ref substring stays as the fallback: low recall by nature,
    // a limit of the data rather than of the query.
    const paths = a.files.map((f) => f.toLowerCase());
    out = out.filter((r) => {
      const stored = (r.files ?? []).map((f) => f.toLowerCase());
      if (stored.some((f) => paths.some((p) => f === p || f.endsWith(`/${p}`))))
        return true;
      const hay =
        `${r.text ?? ""}\n${r.spec ?? ""}\n${r.ref ?? ""}`.toLowerCase();
      return paths.some((p) => hay.includes(p));
    });
  }

  // Newest first — the canonical order. The CLI wrapper reprints oldest-first
  // to keep its legacy output byte-identical (same set, legacy order).
  out.sort((x, y) => y.ts.localeCompare(x.ts));

  const total = out.length;
  const limit = Math.max(0, a.limit ?? FIND_DEFAULT_LIMIT);
  return { rows: out.slice(0, limit), total };
}
