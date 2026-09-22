// src/core/since.ts — parse `--since` (Nd | YYYY-MM-DD) into an ISO timestamp.
//
// Pure date math, no imports. Two callers share it: digest/collect.ts and
// mem find (CLI --since + MCP sinceIso passthrough). It lives in core because
// both are features and core never imports back up (PLAN-unify-mem-engine
// chunk 2 — digest/collect.ts used to own this, but importing it from mem
// would drag db/store + hook.js into the mem load path).

export function parseSince(
  raw: string | undefined,
  now?: number,
): { iso: string; label: string } {
  const def = "7d";
  const s = raw ?? def;
  const dMatch = /^(\d+)d$/.exec(s);
  if (dMatch) {
    const days = Number(dMatch[1]);
    const dt = new Date((now ?? Date.now()) - days * 86400000);
    return { iso: dt.toISOString(), label: `${days}d` };
  }
  const dateMatch = /^\d{4}-\d{2}-\d{2}$/.exec(s);
  if (dateMatch) {
    return { iso: `${s}T00:00:00.000Z`, label: s };
  }
  throw new Error(`invalid --since format: "${s}" — use <N>d or YYYY-MM-DD`);
}
