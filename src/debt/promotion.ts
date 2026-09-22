// src/debt/promotion.ts — promotion signal: "this recurred N times, time for a checker?"
//
// "I'll write eslint when I think of it" — the "think of it" moment is what goes
// missing (SPEC §3) · fapony sees history across sessions (mem + verdicts), so it
// can count how often the same thing was fixed, then put the question to a human —
// it does not decide, does not write the eslint rule itself (SPEC §6 fail list)
//
// Matching "the same thing" — only as precise as the data allows (SPEC §7: old rows
// lack files[], still undecided): a row with files[] must intersect the debt list ·
// the text must mention a convention symbol (ok such as fmtMoney, or an identifier
// ≥ 6 chars from stale such as toLocaleString/useMutation — "throw"/"Error" are too
// short and don't count, to avoid over-matching)

import { openDb } from "../db/store.js";
import { readMemLog } from "../memory.js";
import {
  type Convention,
  type DebtReport,
  PROMOTION_MAX,
  PROMOTION_THRESHOLD,
  type Promotion,
  WORD_MIN,
} from "./types.js";

export type { Promotion };

function conventionWords(conv: Convention): string[] {
  const words = new Set<string>();
  for (const src of [conv.ok, conv.stale]) {
    if (!src) continue;
    for (const m of src.matchAll(/[A-Za-z_$][\w$]*/g)) {
      if (m[0].length >= WORD_MIN) words.add(m[0]);
    }
  }
  return [...words];
}

function rowMatchesConv(
  hay: string,
  files: string[] | undefined,
  debtFiles: Set<string>,
  words: string[],
): boolean {
  if (files && files.length > 0) {
    if (files.some((f) => debtFiles.has(f))) return true;
  }
  const lower = hay.toLowerCase();
  return words.some((w) => lower.includes(w.toLowerCase()));
}

interface EvidenceRow {
  ts: string;
  files?: string[];
  hay: string;
}

function gatherEvidence(worktree: string): EvidenceRow[] {
  const out: EvidenceRow[] = [];
  try {
    for (const r of readMemLog(worktree).rows) {
      if (r.kind !== "bug" && r.kind !== "decision") continue;
      out.push({ ts: r.ts, files: r.files, hay: `${r.text}\n${r.spec ?? ""}` });
    }
  } catch {
    // mem missing — verdicts alone still count
  }
  try {
    const db = openDb();
    const events = db
      .prepare(
        `SELECT e.ts AS ts, e.data AS data FROM events e
         JOIN runs r ON r.id = e.run_id
         WHERE r.worktree = ? AND e.kind = 'gate' ORDER BY e.id`,
      )
      .all(worktree) as { ts: string; data: string | null }[];
    for (const e of events) {
      if (!e.data) continue;
      try {
        const d = JSON.parse(e.data) as {
          verdict?: string;
          reason_code?: string;
          note?: string;
          files?: string[];
        };
        const countsAsFix =
          d.verdict === "fail" ||
          d.reason_code === "scope_mismatch" ||
          d.reason_code === "spec_gap";
        if (!countsAsFix) continue;
        out.push({ ts: e.ts, files: d.files, hay: d.note ?? "" });
      } catch {}
    }
  } catch {
    // no ledger yet — mem alone still counts
  }
  return out;
}

/** Repeated-fix questions for conventions that have no checker and no "no-checker" decision. */
export function findPromotions(
  worktree: string,
  report: DebtReport,
): Promotion[] {
  const evidence = gatherEvidence(worktree);
  if (evidence.length === 0) return [];
  const out: Promotion[] = [];
  for (const entry of report.entries) {
    const { conv } = entry;
    if (conv.checker || conv.decided === "no-checker") continue;
    if (entry.files.length === 0) continue;
    const debtFiles = new Set(entry.files);
    const words = conventionWords(conv);
    const hits = evidence.filter((r) =>
      rowMatchesConv(r.hay, r.files, debtFiles, words),
    );
    if (hits.length < PROMOTION_THRESHOLD) continue;
    const dates = [...new Set(hits.map((h) => h.ts.slice(0, 10)))].sort();
    out.push({
      convId: conv.id,
      rule: conv.rule,
      occurrences: hits.length,
      dates,
      debtCount: entry.files.length,
    });
  }
  // Newest first, capped — three questions are already a conversation.
  out.sort((a, b) => b.occurrences - a.occurrences);
  return out.slice(0, PROMOTION_MAX);
}

export function formatPromotions(promotions: Promotion[]): string[] {
  if (promotions.length === 0) return [];
  const lines: string[] = [
    "",
    "promotion — repeated fixes on conventions with no checker:",
  ];
  for (const p of promotions) {
    lines.push(
      `\n"${p.convId}" (${p.debtCount} file(s) still wrong) came up ${p.occurrences}× ` +
        `(${p.dates.slice(0, 3).join(", ")}${p.dates.length > 3 ? ", …" : ""})`,
    );
    lines.push(`  ${p.rule}`);
    lines.push(
      "  [1] make a checker — an agent drafts the eslint rule in this repo, you review",
    );
    lines.push(
      '  [2] one-off, no checker — record "decided": "no-checker" on this entry, never asked again',
    );
    lines.push("  [3] later — ask again when this comes up a few more times");
  }
  return lines;
}
