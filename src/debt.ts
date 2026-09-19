// src/debt.ts — `fapony debt`: which files have not moved to a shipped convention yet.
//
// The question nobody can answer: "which files have not moved" — rules files
// (CLAUDE.md, Cursor rules) can only say "what the rule is" (layer 2) and
// "which files were copied" (layer 1) — where the debt is (layer 3) lives in
// the owner's head and vanishes when forgotten (SPEC-convention-debt §1)
//
// The convention definition lives in the measured repo (<repo>/.fapony/conventions.json
// — via the same resolver as the mem log, SPEC §2.1) — fapony does not know React
// or Hono and must not · one convention = pattern to use (ok) + pattern meaning
// not-yet-migrated (stale) + scope (where) + file condition (guard, e.g. extends Base)
//
// Debt is computed live every time, never written anywhere (same as analyze:
// a cache is pure debt — a frozen list goes stale silently like MASTER.md) ·
// Iron rule: checker not null = fapony does not report that debt item — reporting
// twice with eslint is an abstraction with one implementation (rule 1) and
// teaches the agent to skip both (SPEC §2)
//
// Read-only stdout: no file writes, no state.db, no cache (rule 5b).

import { existsSync, readFileSync, statSync } from "node:fs";
import { isAbsolute, join, relative, resolve } from "node:path";
import { collectSourceFiles } from "./analyze.js";
import { openDb } from "./db/index.js";
import { readMemLog, resolveMemDir } from "./memory.js";

// A stale regex matching more than this many files is not a convention — it is
// a broken/wide regex (stale="e" would flag the repo). SPEC §6: drop the entry
// and say so, never report 600 files.
const DEBT_FILE_CAP = 250;

export interface Convention {
  id: string;
  rule: string;
  /** Repo-relative dir scope ("." = whole repo). */
  where: string;
  /** Regex source: a match means the file still has the debt. null = not derivable (checker rows) or not filled in yet. */
  stale: string | null;
  /** Regex source: files that already moved (informational count). */
  ok?: string;
  /** Regex source a file must ALSO match to be in scope (e.g. "extends Base"). */
  guard?: string;
  /** Non-null = a checker (eslint rule / script) exists → fapony never reports this debt. */
  checker?: string | null;
  /** Human answered "no checker" on the promotion question — never ask again. */
  decided?: "no-checker" | null;
}

// --- conventions.json resolution (same guess as the mem log, SPEC §2.1) ---

export function resolveConventionsPath(worktree: string): string | null {
  // Conventions live in the same .fapony/ dir as the mem log — derive from
  // the resolved mem dir so both resolvers cannot drift apart.
  const memDir = resolveMemDir(worktree);
  const base = memDir ? join(memDir, "..") : join(worktree, ".fapony");
  const app = join(base, "conventions.json");
  if (existsSync(app)) return app;
  // Monorepo where the app has not scaffolded .fapony/ yet, and single repos
  // that ran `fapony init` at the root — the root file still scopes fine
  // because every `where` is repo-relative.
  const root = join(worktree, ".fapony", "conventions.json");
  return existsSync(root) ? root : null;
}

export interface LoadedConventions {
  path: string | null;
  convs: Convention[];
  /** Rows kept for display but not scannable, plus invalid rows — said out loud, never silent. */
  warnings: string[];
}

function asString(v: unknown): string | undefined {
  return typeof v === "string" && v.length > 0 ? v : undefined;
}

/** Parses .fapony/conventions.json. Missing file = empty + no error (SPEC §6). */
export function loadConventions(worktree: string): LoadedConventions {
  const path = resolveConventionsPath(worktree);
  if (!path) return { path: null, convs: [], warnings: [] };
  let raw: string;
  try {
    raw = readFileSync(path, "utf-8");
  } catch {
    return {
      path,
      convs: [],
      warnings: [`conventions.json unreadable: ${path}`],
    };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    return {
      path,
      convs: [],
      warnings: [
        `conventions.json is not valid JSON — ${
          e instanceof Error ? e.message.split("\n")[0] : "parse error"
        }`,
      ],
    };
  }
  const rows: unknown[] = Array.isArray(parsed)
    ? parsed
    : Array.isArray((parsed as { conventions?: unknown }).conventions)
      ? (parsed as { conventions: unknown[] }).conventions
      : [];
  const convs: Convention[] = [];
  const warnings: string[] = [];
  rows.forEach((r, i) => {
    const o = r as Record<string, unknown>;
    const id = asString(o.id);
    const rule = asString(o.rule);
    if (!id || !rule) {
      warnings.push(
        `conventions[${i}]: id and rule are required — row dropped`,
      );
      return;
    }
    convs.push({
      id,
      rule,
      where: asString(o.where) ?? ".",
      stale: asString(o.stale) ?? null,
      ok: asString(o.ok),
      guard: asString(o.guard),
      checker: asString(o.checker) ?? null,
      decided: o.decided === "no-checker" ? "no-checker" : null,
    });
  });
  return { path, convs, warnings };
}

// --- The scan (fresh every call — derive, never store) ---

interface Compiled {
  conv: Convention;
  staleRe: RegExp | null;
  okRe: RegExp | null;
  guardRe: RegExp | null;
  whereDir: string;
}

function compile(conv: Convention): { c: Compiled; error?: string } {
  const re = (
    src: string | null | undefined,
    what: string,
  ): { re: RegExp | null; error?: string } => {
    if (!src) return { re: null };
    try {
      return { re: new RegExp(src) };
    } catch (e) {
      return {
        re: null,
        error: `${what} regex broken (${e instanceof Error ? e.message.split("\n")[0] : "?"})`,
      };
    }
  };
  const stale = re(conv.stale, `${conv.id}: stale`);
  if (stale.error)
    return {
      c: {
        conv,
        staleRe: null,
        okRe: null,
        guardRe: null,
        whereDir: conv.where,
      },
      error: stale.error,
    };
  const ok = re(conv.ok, `${conv.id}: ok`);
  if (ok.error)
    return {
      c: {
        conv,
        staleRe: null,
        okRe: null,
        guardRe: null,
        whereDir: conv.where,
      },
      error: ok.error,
    };
  const guard = re(conv.guard, `${conv.id}: guard`);
  if (guard.error)
    return {
      c: {
        conv,
        staleRe: null,
        okRe: null,
        guardRe: null,
        whereDir: conv.where,
      },
      error: guard.error,
    };
  return {
    c: {
      conv,
      staleRe: stale.re,
      okRe: ok.re,
      guardRe: guard.re,
      // where="src" must scope src/ and src/x/y.ts but not src-other/;
      // where="." scopes everything.
      whereDir: conv.where === "." ? "" : conv.where.replace(/\/+$/, ""),
    },
  };
}

function inScope(whereDir: string, file: string): boolean {
  return whereDir === "" || file.startsWith(`${whereDir}/`);
}

export interface DebtEntry {
  conv: Convention;
  /** Files with the debt (stale match), sorted. */
  files: string[];
  /** Files that already moved (ok match) — null when ok is not set. */
  movedCount: number | null;
}

export interface DebtReport {
  worktree: string;
  scannedFiles: number;
  ms: number;
  /** Scannable conventions with their debt list (checker rows never land here). */
  entries: DebtEntry[];
  /** Declared but not fillable by fapony: checker null + no stale — the human/agent fills `stale`. */
  declared: Convention[];
  /** Skipped-with-reason: checker rows are silent by design (not dropped), these are real drops. */
  dropped: { id: string; reason: string }[];
  /** Silent-by-design count: checker non-null — reported as a number, not a list. */
  checkedCount: number;
}

export function debtScan(
  worktree: string,
  loaded: LoadedConventions,
): DebtReport {
  const t0 = performance.now();
  const entries: DebtEntry[] = [];
  const declared: Convention[] = [];
  const dropped: { id: string; reason: string }[] = [];
  let checkedCount = 0;

  const compiled: Compiled[] = [];
  for (const conv of loaded.convs) {
    if (conv.checker) {
      // Iron rule — fapony stays silent, leave it to the checker (SPEC §2)
      checkedCount++;
      continue;
    }
    if (!conv.stale) {
      // The one slot a human fills (SPEC §2.2) — show it as pending, don't guess
      declared.push(conv);
      continue;
    }
    const { c, error } = compile(conv);
    if (error || !c.staleRe) {
      dropped.push({ id: conv.id, reason: error ?? "uncompilable" });
      continue;
    }
    if (!existsSync(join(worktree, c.whereDir || "."))) {
      dropped.push({
        id: conv.id,
        reason: `where: ${conv.where} does not exist`,
      });
      continue;
    }
    compiled.push(c);
  }

  const files = collectSourceFiles(worktree);
  const debt: Map<string, string[]> = new Map(
    compiled.map((c) => [c.conv.id, []]),
  );
  const moved: Map<string, number> = new Map(
    compiled.map((c) => [c.conv.id, 0]),
  );
  const tooBroad: Map<string, number> = new Map();

  for (const rel of files) {
    let content: string;
    try {
      content = readFileSync(join(worktree, rel), "utf-8");
    } catch {
      continue;
    }
    for (const c of compiled) {
      if (!c.staleRe) continue; // filtered at compile; narrows the type
      if (!inScope(c.whereDir, rel)) continue;
      if (c.guardRe && !c.guardRe.test(content)) continue;
      if (c.staleRe.test(content)) {
        const cur = debt.get(c.conv.id) ?? [];
        cur.push(rel);
        debt.set(c.conv.id, cur);
        // Stop counting a runaway regex early — the entry will be dropped.
        if (cur.length > DEBT_FILE_CAP) tooBroad.set(c.conv.id, cur.length);
      }
      if (c.okRe?.test(content)) {
        moved.set(c.conv.id, (moved.get(c.conv.id) ?? 0) + 1);
      }
    }
  }

  for (const c of compiled) {
    const n = tooBroad.get(c.conv.id);
    if (n !== undefined) {
      dropped.push({
        id: c.conv.id,
        reason: `stale regex matches ${n}+ files — too broad, entry dropped (narrow stale/where/guard)`,
      });
      continue;
    }
    entries.push({
      conv: c.conv,
      files: (debt.get(c.conv.id) ?? []).sort(),
      movedCount: c.okRe ? (moved.get(c.conv.id) ?? 0) : null,
    });
  }

  return {
    worktree,
    scannedFiles: files.length,
    ms: Math.round(performance.now() - t0),
    entries,
    declared,
    dropped,
    checkedCount,
  };
}

/** Per-file lookup (hook-read-hint + --files): which conventions flag this file. */
export function debtForFile(
  worktree: string,
  absFile: string,
  loaded: LoadedConventions,
): Convention[] {
  const rel = relative(worktree, absFile).split("\\").join("/");
  if (rel.startsWith("..") || isAbsolute(rel)) return [];
  let content: string;
  try {
    content = readFileSync(absFile, "utf-8");
  } catch {
    return [];
  }
  const out: Convention[] = [];
  for (const conv of loaded.convs) {
    if (conv.checker || !conv.stale) continue;
    const { c, error } = compile(conv);
    if (error || !c.staleRe) continue;
    if (!inScope(c.whereDir, rel)) continue;
    if (c.guardRe && !c.guardRe.test(content)) continue;
    if (c.staleRe.test(content)) out.push(conv);
  }
  return out;
}

// --- Promotion signal (chunk 5) — "this recurred N times, time for a checker?" ---
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

export const PROMOTION_THRESHOLD = 3;
const PROMOTION_MAX = 3;
/** Identifiers shorter than this are too generic to match prose on ("throw", "Error"). */
const WORD_MIN = 6;

export interface Promotion {
  convId: string;
  rule: string;
  occurrences: number;
  dates: string[];
  debtCount: number;
}

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

// --- Formatting ---

// Zone grouping: how many leading path segments define a "zone" for chunking debt.
const ZONE_DEPTH = 3;
// Default cap on zones shown per convention — more than this is a wall, not an answer.
const ZONE_CAP = 6;

/** Group files by their first N path segments (the "zone"). */
function groupFilesByZone(
  files: string[],
  depth: number,
): Map<string, string[]> {
  const zones = new Map<string, string[]>();
  for (const f of files) {
    const parts = f.split("/");
    const zone = parts.slice(0, depth).join("/");
    const cur = zones.get(zone) ?? [];
    cur.push(f);
    zones.set(zone, cur);
  }
  // Sort zones by file count descending, then alphabetically
  return new Map(
    [...zones.entries()].sort((a, b) => {
      const d = b[1].length - a[1].length;
      return d !== 0 ? d : a[0].localeCompare(b[0]);
    }),
  );
}

/** Escape a regex source for use in a shell grep command. */
function shellEscapeRe(src: string): string {
  return src.replace(/'/g, "'\\''");
}

export function formatDebt(report: DebtReport, showAll = false): string {
  const lines: string[] = [];
  lines.push(
    `fapony debt — ${report.entries.length + report.declared.length + report.checkedCount} convention(s), ` +
      `${report.scannedFiles} files scanned, ${report.ms}ms — derived fresh, not stored`,
  );
  for (const e of report.entries) {
    const moved =
      e.movedCount !== null && e.files.length > 0
        ? ` · moved ${e.movedCount} (${Math.round((e.movedCount / (e.files.length + e.movedCount)) * 100)}%)`
        : e.movedCount !== null
          ? ` · moved ${e.movedCount}`
          : "";
    lines.push(`\n${e.conv.id} — ${e.conv.rule}`);
    // Show the patterns actually used
    const patterns: string[] = [];
    if (e.conv.stale) patterns.push(`stale: ${e.conv.stale}`);
    if (e.conv.ok) patterns.push(`ok: ${e.conv.ok}`);
    if (e.conv.guard) patterns.push(`guard: ${e.conv.guard}`);
    patterns.push(`where ${e.conv.where}`);
    lines.push(`  ${patterns.join("  ·  ")}`);
    if (e.files.length === 0) {
      lines.push(`  debt 0${moved} — clean`);
      continue;
    }
    lines.push(`  debt ${e.files.length}${moved}`);
    // Verify command derived from stale
    if (e.conv.stale) {
      lines.push(`  verify: grep -rn '${shellEscapeRe(e.conv.stale)}' <zone>`);
    }
    // Zone grouping
    const zones = groupFilesByZone(e.files, ZONE_DEPTH);
    const zoneEntries = [...zones.entries()];
    const cap = showAll
      ? zoneEntries.length
      : Math.min(zoneEntries.length, ZONE_CAP);
    let totalCapped = 0;
    for (let i = 0; i < cap; i++) {
      const [zone, zoneFiles] = zoneEntries[i];
      const pad = " ".repeat(Math.max(0, 42 - zone.length));
      lines.push(`\n  ${zone}${pad}${zoneFiles.length} ไฟล์`);
      lines.push(`    ${zoneFiles.map((f) => f.split("/").pop()).join(" · ")}`);
      totalCapped += zoneFiles.length;
    }
    if (zoneEntries.length > cap) {
      const remaining = e.files.length - totalCapped;
      const remainingZones = zoneEntries.length - cap;
      lines.push(
        `\n  … อีก ${remainingZones} โซน (${remaining} ไฟล์) — fapony debt --id ${e.conv.id} --all`,
      );
    }
  }
  for (const c of report.declared) {
    lines.push(`\n${c.id} — ${c.rule} (where ${c.where})`);
    lines.push(
      `  declared, no checker, stale not filled in — fill "stale" in conventions.json`,
    );
  }
  if (report.checkedCount > 0) {
    lines.push(
      `\n${report.checkedCount} convention(s) have a checker — fapony stays silent, the checker reports`,
    );
  }
  for (const d of report.dropped) {
    lines.push(`⚠ ${d.id}: ${d.reason}`);
  }
  return lines.join("\n");
}

// --- CLI ---

const USAGE = `usage: fapony debt [path] [options]
  --files f1,f2     check specific files instead of scanning
  --id <conv>       show only this convention
  --where <path>    narrow scope to files under this path
  --all             show all zones (default: cap at ${ZONE_CAP})
  --json            output raw JSON
  -h, --help        this help`;

function worktreeOf(arg: string | undefined): string {
  const base = resolve(arg ?? ".");
  try {
    const p = Bun.spawnSync(["git", "rev-parse", "--show-toplevel"], {
      cwd: base,
      stdout: "pipe",
      stderr: "pipe",
    });
    if (p.exitCode === 0) return p.stdout.toString().trim();
  } catch {
    // fall through
  }
  return base;
}

export function cmdDebt(args: string[]): void {
  let path: string | undefined;
  let filesMode: string[] | null = null;
  let json = false;
  let filterId: string | undefined;
  let wherePath: string | undefined;
  let showAll = false;
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--files") {
      const v = args[i + 1];
      if (!v || v.startsWith("--")) {
        console.error(`fapony debt: --files needs a value\n${USAGE}`);
        process.exit(1);
      }
      i++;
      filesMode = v
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
      if (filesMode.length === 0) {
        console.error(`fapony debt: --files needs at least one path\n${USAGE}`);
        process.exit(1);
      }
    } else if (a === "--id") {
      const v = args[i + 1];
      if (!v || v.startsWith("--")) {
        console.error(`fapony debt: --id needs a convention id\n${USAGE}`);
        process.exit(1);
      }
      i++;
      filterId = v;
    } else if (a === "--where") {
      const v = args[i + 1];
      if (!v || v.startsWith("--")) {
        console.error(`fapony debt: --where needs a path\n${USAGE}`);
        process.exit(1);
      }
      i++;
      wherePath = v;
    } else if (a === "--all") {
      showAll = true;
    } else if (a === "--json") {
      json = true;
    } else if (a === "-h" || a === "--help") {
      console.log(USAGE);
      return;
    } else if (!a.startsWith("--")) {
      path = a;
    } else {
      console.error(`fapony debt: unknown argument "${a}"\n${USAGE}`);
      process.exit(1);
    }
  }

  const worktree = worktreeOf(path);
  const loaded = loadConventions(worktree);

  if (filesMode) {
    const out = filesMode.map((f) => {
      const abs = isAbsolute(f) ? f : resolve(worktree, f);
      if (!existsSync(abs) || !statSync(abs).isFile()) {
        return { file: f, debt: [], note: "not found" as const };
      }
      return { file: f, debt: debtForFile(worktree, abs, loaded) };
    });
    if (json) {
      console.log(JSON.stringify({ worktree, files: out }, null, 2));
      return;
    }
    let any = false;
    for (const r of out) {
      for (const c of r.debt) {
        any = true;
        console.log(`${r.file} — ${c.id}: ${c.rule}`);
      }
      if ("note" in r) console.log(`${r.file} — ${r.note}`);
    }
    if (!any && out.every((r) => r.debt.length === 0)) {
      console.log("no convention debt in the given file(s)");
    }
    return;
  }

  if (loaded.path === null) {
    // SPEC §6: no conventions.json = completely silent, no error, no prompt to create one
    console.log(
      `fapony debt — no conventions.json in ${worktree} (nothing tracked yet)`,
    );
    return;
  }
  const report = debtScan(worktree, loaded);

  // --id filter: keep only the named convention
  if (filterId) {
    report.entries = report.entries.filter((e) => e.conv.id === filterId);
    report.declared = report.declared.filter((c) => c.id === filterId);
    report.checkedCount = 0; // not relevant when filtering
    report.dropped = report.dropped.filter((d) => d.id === filterId);
  }

  // --where filter: narrow file lists to paths under the given prefix
  if (wherePath) {
    const prefix = wherePath.replace(/\/+$/, "");
    for (const e of report.entries) {
      e.files = e.files.filter(
        (f) => f === prefix || f.startsWith(`${prefix}/`),
      );
    }
  }

  if (json) {
    console.log(
      JSON.stringify(
        { ...report, promotions: findPromotions(worktree, report) },
        null,
        2,
      ),
    );
    return;
  }
  console.log(formatDebt(report, showAll));
  for (const w of loaded.warnings) console.log(`⚠ ${w}`);
  for (const l of formatPromotions(findPromotions(worktree, report))) {
    console.log(l);
  }
}
