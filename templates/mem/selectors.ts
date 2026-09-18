// selectors.ts — derive open/claimed/stale views from the append-only log

import type {
  ClaimRow,
  CloseRow,
  LogRow,
  ReleaseRow,
  WorkRow,
} from "./store.js";

// ponytail: reducer = filter + tombstone set. 50k lines = 9.6MB/26ms — the file is not the bottleneck
// the real ceiling = too many open rows for the view to make sense → rotate then: git mv + append openRows(old) into a new file
export const openRows = (all: LogRow[]): WorkRow[] => {
  const dead = new Set(
    all.filter((r): r is CloseRow => r.kind === "close").map((r) => r.ref),
  );
  return all.filter(
    (r): r is WorkRow =>
      r.kind !== "close" &&
      r.kind !== "claim" &&
      r.kind !== "release" &&
      r.kind !== "synced" &&
      "id" in r &&
      !dead.has(r.id),
  );
};

// C) claimsOf: returns Map ref → latest claim row still active
// active = the latest claim|release row is a claim and ref is not in dead (close)
export const claimsOf = (all: LogRow[]): Map<string, ClaimRow> => {
  const dead = new Set(
    all.filter((r): r is CloseRow => r.kind === "close").map((r) => r.ref),
  );
  const latest = new Map<string, ClaimRow | ReleaseRow>();
  for (const r of all) {
    if (r.kind === "claim" || r.kind === "release") {
      latest.set(r.ref, r);
    }
  }
  const active = new Map<string, ClaimRow>();
  for (const [ref, r] of latest) {
    if (r.kind === "claim" && !dead.has(ref)) {
      active.set(ref, r);
    }
  }
  return active;
};

// a decision newer than both the spec's latest commit and the synced marker = spec not updated to match
// + next/hold whose spec was edited after creation = may be done already but nobody closed it — real case: msbnndmt
// + an active claim older than 4h = the agent may have died mid-task
export const staleReport = (all: LogRow[]): string[] => {
  const out: string[] = [];
  const mark: Record<string, number> = {};
  for (const r of all) {
    if (r.kind === "synced") mark[r.spec] = Date.parse(r.ts);
  }

  // batch: collect unique spec paths, spawn one git per path
  const specPaths = new Set<string>();
  for (const r of all) {
    if (r.kind === "decision" && r.spec) specPaths.add(r.spec);
  }
  for (const r of openRows(all)) {
    if ((r.kind === "next" || r.kind === "hold") && r.spec)
      specPaths.add(r.spec);
  }
  const gitDates = new Map<string, number>();
  for (const spec of specPaths) {
    // --follow: a spec path that was git mv'd (e.g. moved into plan/done/) can still follow its history
    const git = Bun.spawnSync([
      "git",
      "log",
      "-1",
      "--follow",
      "--format=%cI",
      "--",
      spec,
    ])
      .stdout.toString()
      .trim();
    if (git) gitDates.set(spec, Date.parse(git));
  }

  for (const r of all) {
    if (r.kind === "decision" && r.spec) {
      const base = Math.max(gitDates.get(r.spec) ?? 0, mark[r.spec] ?? 0);
      if (base < Date.parse(r.ts))
        out.push(
          `STALE ${r.spec}: decision ${r.ts.slice(0, 10)} never made it into the spec — "${r.text}"`,
        );
    }
  }
  for (const r of openRows(all)) {
    if ((r.kind === "next" || r.kind === "hold") && r.spec) {
      const gitDate = gitDates.get(r.spec);
      // ponytail: 24h grace — "log next then write/commit the plan the same day" is normal workflow
      // not a signal that the work finished and was forgotten (the real case to catch, msbnndmt, is days apart) —
      // without grace = SUSPECT fires on every freshly written plan, and everyone learns to skim past the whole stale block
      if (gitDate && gitDate > Date.parse(r.ts) + 86_400_000)
        out.push(
          `SUSPECT [${r.id}] ${r.spec} changed after this ${r.kind} (${r.ts.slice(0, 10)}) — check whether it is already done`,
        );
    }
  }
  const claims = claimsOf(all);
  for (const [ref, c] of claims) {
    const ageH = (Date.now() - Date.parse(c.ts)) / 3_600_000;
    if (ageH > 4) {
      out.push(
        `SUSPECT claim [${ref}] by ${c.agent} ${c.ts.slice(0, 10)} never closed/released — the agent may have died mid-task`,
      );
    }
  }
  return out;
};

// rotate: rows that must carry over into the new log file after archiving
// - open next/bug/hold + still-active claims on those rows (close/claim of already-closed refs = discardable)
// - decision/note has no "close" of its own (permanent history by design) but resolves indirectly via synced:
//   spec was synced *after* this row = the info really made it into the spec, archive (git) is enough, no need to carry it in the hot file
//   (same logic as staleReport's decision check — no spec or not yet synced by this row = still considered relevant, keep it)
// ponytail: a decision/note with no spec gives no way to know if it is resolved — keep it forever (the real ceiling is
// attaching a spec at log time if you want rotate to be able to drop it later, not rotate's own problem)
export const rotateKeep = (all: LogRow[]): LogRow[] => {
  const open = openRows(all);
  const workOpen = open.filter(
    (r) => r.kind === "next" || r.kind === "bug" || r.kind === "hold",
  );
  const claims = claimsOf(all);
  const openIds = new Set(workOpen.map((r) => r.id));
  const keepClaims = [...claims.values()].filter((c) => openIds.has(c.ref));

  const syncedAt: Record<string, number> = {};
  for (const r of all)
    if (r.kind === "synced") syncedAt[r.spec] = Date.parse(r.ts);
  const keepDecisionNote = open.filter(
    (r) =>
      (r.kind === "decision" || r.kind === "note") &&
      (!r.spec || !(r.spec in syncedAt) || syncedAt[r.spec] < Date.parse(r.ts)),
  );

  return [...workOpen, ...keepDecisionNote, ...keepClaims];
};
