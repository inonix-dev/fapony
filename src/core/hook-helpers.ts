// src/core/hook-helpers.ts — pure helpers shared by hook adapters
//
// Extracted from src/hook.ts (PLAN-lib-layer chunk 3). These have zero
// feature imports and are reused by stop, read-hint, edit-hint, and
// session-start adapters.

import { basename } from "node:path";

/** UTC 'YYYY-MM-DD HH:MM:SS' — the format events.ts is written in. */
export function utcStamp(d: Date): string {
  return d.toISOString().slice(0, 19).replace("T", " ");
}

/**
 * Parse either timestamp shape this repo produces: mem rows are ISO
 * (`new Date().toISOString()`), session start is utcStamp
 * ('YYYY-MM-DD HH:MM:SS', UTC). Never compare them as strings — 'T' > ' '
 * makes any same-date mem row read as "newer than session start".
 */
export function hookTsMs(ts: string): number {
  const iso = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(ts)
    ? `${ts.replace(" ", "T")}Z`
    : ts;
  return new Date(iso).getTime();
}

/** Filename key for a session — basename of a transcript path or a raw id. */
export function sessionKey(session: string): string {
  const base = basename(session).replace(/\.[^.]+$/, "");
  return base.replace(/[^A-Za-z0-9_-]/g, "-") || "unknown";
}
