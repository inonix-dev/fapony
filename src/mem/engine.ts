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
}

export interface EngineAddResult {
  id: string;
  kind: string;
  text: string;
  files: string[];
  spec?: string;
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
  put({
    id,
    kind: a.kind as WorkKind,
    text: a.text,
    spec: a.spec,
    files: a.files,
  });
  return { id, kind: a.kind, text: a.text, files: a.files, spec: a.spec, ts };
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
