// render.ts — formatting and display helpers for the memory log

import { claimsOf, openRows } from "./selectors.js";
import type { ClaimRow, CloseRow, LogRow, WorkRow } from "./store.js";

export const fmtRow = (r: WorkRow, claims?: Map<string, ClaimRow>) => {
  let s = `- [${r.id}]`;
  if (claims?.has(r.id)) s += ` (${claims.get(r.id)?.agent})`;
  s += ` ${r.kind} ${r.text}`;
  if (r.spec) s += ` → ${r.spec}`;
  return s;
};

export const printOpenRows = (all: LogRow[], opts?: { showHold?: boolean }) => {
  const open = openRows(all);
  const claims = claimsOf(all);

  // in-progress (claimed items)
  const inProg = open.filter(
    (r) => claims.has(r.id) && (r.kind === "next" || r.kind === "bug"),
  );
  if (inProg.length) {
    console.log(
      `\n## in-progress\n${inProg.map((r) => fmtRow(r, claims)).join("\n")}`,
    );
  }

  // next (unclaimed only)
  const nexts = open.filter((r) => r.kind === "next" && !claims.has(r.id));
  if (nexts.length) {
    console.log(`\n## next\n${nexts.map((r) => fmtRow(r)).join("\n")}`);
  }

  // bug (unclaimed only)
  const bugs = open.filter((r) => r.kind === "bug" && !claims.has(r.id));
  if (bugs.length) {
    console.log(`\n## bug\n${bugs.map((r) => fmtRow(r)).join("\n")}`);
  }

  // hold — sorted by spec for per-plan visibility
  if (opts?.showHold) {
    const holds = open
      .filter((r) => r.kind === "hold")
      .sort((a, b) => (a.spec ?? "").localeCompare(b.spec ?? ""));
    if (holds.length) {
      console.log(`\n## hold\n${holds.map((r) => fmtRow(r)).join("\n")}`);
    }
  }
};

export const fmtClose = (c: CloseRow, byId: Map<string, WorkRow>) => {
  const o = byId.get(c.ref);
  const agentStr = c.agent && c.agent !== "unknown" ? ` (${c.agent})` : "";
  return `- ${c.ts.slice(0, 10)}${agentStr} ${o && "text" in o ? o.text : c.ref} → ${c.text}`;
};

export const doneLines = (all: LogRow[], limit?: number) => {
  const workAll = all.filter((r): r is WorkRow => "id" in r);
  const byId = new Map(workAll.map((r) => [r.id, r] as const));
  const closes = all.filter((r): r is CloseRow => r.kind === "close").reverse();
  const slice = limit ? closes.slice(0, limit) : closes;
  return slice.map((c) => fmtClose(c, byId));
};
