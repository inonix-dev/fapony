// commands/read.ts — read-only commands: now (default), done, stale, find, kickoff

import { doneLines, fmtClose, fmtRow, printOpenRows } from "../render.js";
import { claimsOf, openRows, staleReport } from "../selectors.js";
import type { CloseRow, WorkRow } from "../store.js";
import { app, memCmd, rows } from "../store.js";
import { planSweepCmd, shippedNotMoved } from "./plan.js";
import { THRESHOLD } from "./rotate.js";

const rotateLine = (n: number) =>
  n >= THRESHOLD
    ? `\n## 🗜 log ${n} rows (≥ ${THRESHOLD}) — run: ${memCmd} rotate --apply`
    : "";

const planSweepLine = () => {
  const pending = shippedNotMoved();
  return pending.length
    ? `\n## 📦 shipped but not archived into done/ (${pending.length})\n` +
        pending.map((n) => `- ${n}`).join("\n") +
        `\n(move: ${planSweepCmd} <file.md> --apply)`
    : "";
};

export const cmdNow = () => {
  // mem now (default) — next+bug+hold. decision/note is not pending work → search with find instead
  const all = rows();
  console.log(`# ${app} — ${all.length} entries`);
  printOpenRows(all, { showHold: true });
  const decisionN = openRows(all).filter((r) => r.kind === "decision").length;
  const noteN = openRows(all).filter((r) => r.kind === "note").length;
  console.log(
    `\n## decision ${decisionN} · note ${noteN} — search: ${memCmd} find <word>`,
  );
  const stale = staleReport(all);
  if (stale.length)
    console.log(
      `\n## ⚠ stale (${stale.length})\n` +
        stale.map((l) => `- ${l}`).join("\n"),
    );
  const sweep = planSweepLine();
  if (sweep) console.log(sweep);
  const rotate = rotateLine(all.length);
  if (rotate) console.log(rotate);
};

export const cmdDone = () => {
  const all = rows();
  for (const l of doneLines(all)) console.log(l);
};

export const cmdStale = () => {
  for (const l of staleReport(rows())) console.log(l);
};

export const cmdFind = (a: string[]) => {
  // mem find <word> — grep text/spec case-insensitively, newest first, capped at 20 rows
  const q = a.join(" ").toLowerCase();
  if (!q) {
    console.error(`usage: ${memCmd} find <word>`);
    process.exit(1);
  }
  const hits = rows()
    .filter(
      (r): r is WorkRow =>
        r.kind !== "close" &&
        r.kind !== "synced" &&
        r.kind !== "claim" &&
        r.kind !== "release",
    )
    .filter(
      (r) =>
        r.text.toLowerCase().includes(q) ||
        (r.spec ?? "").toLowerCase().includes(q),
    )
    .slice(-20);
  for (const r of hits)
    console.log(
      `- [${r.id}] ${r.ts.slice(0, 10)} ${r.kind} ${r.text}${r.spec ? ` → ${r.spec}` : ""}`,
    );
  if (!hits.length) console.log("(no matches)");
};

export const cmdKickoff = (a: string[]) => {
  // mem kickoff [id|spec.md]
  const all = rows();
  const arg = a[0] ?? "";

  if (!arg) {
    // no args = now + a "recent" section = the last 10 closes
    console.log(`# ${app} — ${all.length} entries`);
    printOpenRows(all, { showHold: true });
    console.log(`\n## recent\n${doneLines(all, 10).join("\n")}`);
    const stale = staleReport(all);
    if (stale.length)
      console.log(
        `\n## ⚠ stale (${stale.length})\n` +
          stale.map((l) => `- ${l}`).join("\n"),
      );
    const sweep = planSweepLine();
    if (sweep) console.log(sweep);
    const rotate = rotateLine(all.length);
    if (rotate) console.log(rotate);
  } else if (arg.endsWith(".md")) {
    // spec.md = a brief for that spec
    const workAll = all.filter((r): r is WorkRow => "id" in r);
    const byId = new Map(workAll.map((r) => [r.id, r] as const));
    const open = openRows(all);
    const specRows = open.filter((r) => r.spec === arg);
    const specDecisions = all
      .filter((r): r is WorkRow => r.kind === "decision" && r.spec === arg)
      .slice(-5);
    const specCloses = all
      .filter((r): r is CloseRow => r.kind === "close")
      .filter((r) => byId.get(r.ref)?.spec === arg)
      .slice(-3);

    console.log(`# ${arg} — ${specRows.length} open rows`);
    if (specRows.length) {
      console.log(`\n## open\n${specRows.map((r) => fmtRow(r)).join("\n")}`);
    }
    if (specDecisions.length) {
      console.log(
        `\n## decisions\n` +
          specDecisions
            .map((r) => `- ${r.ts.slice(0, 10)} ${r.text}`)
            .join("\n"),
      );
    }
    if (specCloses.length) {
      console.log(
        `\n## closes\n${specCloses.map((c) => fmtClose(c, byId)).join("\n")}`,
      );
    }
    if (!specRows.length && !specDecisions.length && !specCloses.length) {
      console.log("(no entries for this spec)");
    }
  } else {
    // id = a brief for that task
    const workAll = all.filter((r): r is WorkRow => "id" in r);
    const byId = new Map(workAll.map((r) => [r.id, r] as const));
    const target = byId.get(arg);
    if (!target) {
      console.error(`no id "${arg}" in the log`);
      process.exit(1);
    }
    const claims = claimsOf(all);
    const claimInfo = claims.has(arg)
      ? `\nClaimed by: ${claims.get(arg)?.agent} (${claims.get(arg)?.ts.slice(0, 10)})`
      : "";

    const spec = target.spec;
    const open = spec
      ? openRows(all).filter((r) => r.spec === spec && r.id !== arg)
      : [];
    const specDecisions = spec
      ? all
          .filter((r): r is WorkRow => r.kind === "decision" && r.spec === spec)
          .slice(-5)
      : [];
    const specNotes = spec
      ? all
          .filter((r): r is WorkRow => r.kind === "note" && r.spec === spec)
          .slice(-5)
      : [];
    const specCloses = spec
      ? all
          .filter((r): r is CloseRow => r.kind === "close")
          .filter((r) => byId.get(r.ref)?.spec === spec)
          .slice(-3)
      : [];

    console.log(
      `# [${target.id}] ${target.kind} — ${target.text}${target.spec ? ` → ${target.spec}` : ""}${claimInfo}`,
    );
    if (open.length) {
      console.log(
        `\n## open (same spec)\n` +
          open.map((r) => fmtRow(r, claims)).join("\n"),
      );
    }
    if (specDecisions.length || specNotes.length) {
      console.log(`\n## decisions & notes (spec)\n`);
      for (const r of [...specDecisions, ...specNotes]) {
        console.log(`- ${r.ts.slice(0, 10)} ${r.kind} ${r.text}`);
      }
    }
    if (specCloses.length) {
      console.log(
        `\n## closes (spec)\n` +
          specCloses.map((c) => fmtClose(c, byId)).join("\n"),
      );
    }
  }
};
