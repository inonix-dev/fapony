// src/stats/data.ts — StatsData shape + getStatsData()

import { readdirSync } from "node:fs";
import { join } from "node:path";
import { type Event, openDb, PLAN_DIR, type Run } from "../db/index.js";
import { loadConfig } from "../db/load.js";
import { enrichGateWindows } from "../gates.js";
import { REASON_CODES, REGIME_CODES } from "../mcp/types.js";
import {
  isPassFamily,
  qualityScore,
  VERDICT_GRADES,
  type VerdictGrade,
} from "../parse.js";
import {
  type PassiveUsageResult,
  readClaudeCodeUsage,
  readCodexUsage,
  readPassiveUsage,
  readZcodeUsage,
} from "../session/index.js";
import { avg, minutesBetween } from "../util.js";

// Walks events per run in order and pairs up spawn→route (executor time)
// and route→gate (review turnaround) per round, since one run row can span
// multiple rounds (spawn/commit/route/gate repeating).
function stageMinutes(events: Event[]): { exec: number[]; review: number[] } {
  const exec: number[] = [];
  const review: number[] = [];
  let spawnTs: string | null = null;
  let routeTs: string | null = null;

  for (const e of events) {
    if (e.kind === "spawn") spawnTs = e.ts;
    else if (e.kind === "route") {
      if (spawnTs) exec.push(minutesBetween(spawnTs, e.ts));
      routeTs = e.ts;
    } else if (e.kind === "gate") {
      if (routeTs) review.push(minutesBetween(routeTs, e.ts));
      routeTs = null;
    }
  }
  return { exec, review };
}

// --- Per-gate enrichment: model attribution (read-time join) ---

interface EnrichedGate {
  runId: number;
  verdict: string;
  model: string | null;
  provider: string | null;
  client: string | null;
  agent: string | null;
  /** How `model` was resolved — "inferred" is a guess, not a declaration. */
  modelSource: "spawn" | "session_id" | "inferred" | null;
  /** Session the token totals belong to — dedupe key, never summed per gate. */
  sessionId: string | null;
  /** Total input tokens for the session (null when unknown or spawn-based). */
  tokensInput: number | null;
  /** Total output tokens for the session (null when unknown or spawn-based). */
  tokensOutput: number | null;
}

/**
 * Read-time join (SPEC-verdict-stats): per gate, model comes only from
 * kind='spawn' events in (prevGateId, gateId) of the same run — per-round,
 * never cumulative. Windowing lives in enrichGateWindows (src/gates.ts).
 */
function enrichGates(
  events: Event[],
  worktreeByRun?: Map<number, string>,
): EnrichedGate[] {
  return enrichGateWindows(events, worktreeByRun).map((w) => ({
    runId: w.runId,
    verdict: w.verdict,
    model: w.model,
    provider: w.provider,
    client: w.client,
    agent: w.agent,
    modelSource: w.modelSource,
    sessionId: w.sessionId,
    tokensInput: w.tokensInput,
    tokensOutput: w.tokensOutput,
  }));
}

/**
 * Count un-shipped plan files in a worktree's planDir.
 *
 * planDir is hardcoded to .fapony/plan — not configurable (gitignored = private).
 *
 * Returns null — never 0 — when the path isn't a readable directory, so a
 * sentinel row like "mcp-external" renders as "—" instead of claiming
 * "nothing pending", which would be a lie.
 */
export function countPendingPlans(worktree: string): number | null {
  if (!worktree.startsWith("/")) return null;
  try {
    return readdirSync(join(worktree, PLAN_DIR)).filter((f) =>
      f.endsWith(".md"),
    ).length;
  } catch {
    return null;
  }
}

// --- Cross-run knowledge queries (PLAN-project-health-context §2) ---
//
// Pure functions over already-loaded runs/events — no extra SQL, read-only.
// reason_code comes from gate event data: `reason_code` field (patched by
// verdict_submit) with fallback to the `[reason_code]` note prefix that
// gateOnce writes. Only non-pass gates count (recurring failure signature).

export interface ReasonCodeCount {
  worktree: string;
  reason: string;
  count: number;
}

export interface PlanBreakdown {
  plan: string;
  runs: number;
  passed: number;
  escalated: number;
  /** Worktrees that have at least one run with this plan (sorted). */
  worktrees: string[];
}

export interface EscalatedRun {
  id: number;
  worktree: string;
  plan: string | null;
  round: number;
}

export interface BestPassing {
  plan: string;
  worktree: string;
}

/** maxRounds from config (default 2) — the round-cap signal (CLAUDE.md #2). */
export function resolveMaxRounds(): number {
  try {
    const mr = loadConfig().review?.maxRounds;
    return typeof mr === "number" && mr >= 0 ? mr : 2;
  } catch {
    return 2;
  }
}

/** Reason code on a gate event, regardless of pass/fail (for note surfacing). */
function eventReasonCode(data: string | null): string | null {
  if (!data) return null;
  try {
    const d = JSON.parse(data) as { reason_code?: unknown; note?: unknown };
    if (
      typeof d.reason_code === "string" &&
      (REASON_CODES as readonly string[]).includes(d.reason_code)
    )
      return d.reason_code;
    // Fallback: gateOnce writes `[reason_code]` note prefix via verdict_submit.
    if (typeof d.note === "string") {
      const m = /^\[([a-z_]+)\]/.exec(d.note);
      if (m && (REASON_CODES as readonly string[]).includes(m[1])) return m[1];
    }
    return null;
  } catch {
    return null;
  }
}

/** Reason code on a non-pass gate event only (byReasonCode KPI — fail signal). */
function gateReason(data: string | null): string | null {
  if (!data) return null;
  try {
    const d = JSON.parse(data) as { verdict?: unknown };
    if (
      typeof d.verdict === "string" &&
      (d.verdict === "pass" || d.verdict.startsWith("pass-"))
    )
      return null;
  } catch {
    return null;
  }
  return eventReasonCode(data);
}

export interface FileRisk {
  worktree: string;
  file: string;
  /** Gate verdicts that listed this file. */
  gates: number;
  /** Of those, non-pass-family verdicts. */
  fails: number;
  /** reason_code of the most recent failing gate on this file. */
  lastReason: string | null;
}

/**
 * Per-file risk: how often a file appeared in a gate verdict, and how often
 * that verdict was non-pass. Reads files[] already stored on gate events —
 * no new table, no new write path.
 *
 * Counts are "touches that were graded", not edits: a file only shows up here
 * once someone submitted a verdict naming it, so absence means unmeasured,
 * never safe. Read a row as a prior, not a score — at gates=1 it is one
 * anecdote.
 */
function getFileRisk(runs: Run[], events: Event[]): FileRisk[] {
  const wtByRun = new Map(runs.map((r) => [r.id, r.worktree]));
  const map = new Map<
    string,
    {
      worktree: string;
      file: string;
      gates: number;
      fails: number;
      lastReason: string | null;
    }
  >();
  for (const e of events) {
    if (e.kind !== "gate") continue;
    let verdict: string | null = null;
    let files: string[] = [];
    try {
      const d = JSON.parse(e.data ?? "{}") as {
        verdict?: unknown;
        files?: unknown;
      };
      if (typeof d.verdict === "string" && VERDICT_GRADES.has(d.verdict))
        verdict = d.verdict;
      if (Array.isArray(d.files))
        files = d.files.filter(
          (f): f is string => typeof f === "string" && !!f,
        );
    } catch {
      continue; // unparseable gate data — nothing to attribute
    }
    if (!verdict || files.length === 0) continue;
    const wt = wtByRun.get(e.run_id) ?? "(unknown)";
    const failed = !isPassFamily(verdict);
    const reason = failed ? eventReasonCode(e.data) : null;
    for (const file of files) {
      const key = `${wt}\u0000${file}`;
      let b = map.get(key);
      if (!b) {
        b = { worktree: wt, file, gates: 0, fails: 0, lastReason: null };
        map.set(key, b);
      }
      b.gates++;
      if (failed) {
        b.fails++;
        // events arrive oldest-first, so the last write wins = most recent.
        if (reason) b.lastReason = reason;
      }
    }
  }
  return [...map.values()].sort(
    (a, b) =>
      b.fails - a.fails ||
      b.gates - a.gates ||
      (a.file < b.file ? -1 : a.file > b.file ? 1 : 0),
  );
}

/** Top reason_code per worktree, sorted by count desc (spec §2 query). */
function getReasonCodeBreakdown(
  runs: Run[],
  events: Event[],
): ReasonCodeCount[] {
  const wtByRun = new Map(runs.map((r) => [r.id, r.worktree]));
  const counts = new Map<string, Map<string, number>>();
  for (const e of events) {
    if (e.kind !== "gate") continue;
    const reason = gateReason(e.data);
    if (!reason) continue;
    const wt = wtByRun.get(e.run_id) ?? "(unknown)";
    let inner = counts.get(wt);
    if (!inner) {
      inner = new Map();
      counts.set(wt, inner);
    }
    inner.set(reason, (inner.get(reason) ?? 0) + 1);
  }
  const out: ReasonCodeCount[] = [];
  for (const [worktree, inner] of counts)
    for (const [reason, count] of inner) out.push({ worktree, reason, count });
  return out.sort((a, b) => b.count - a.count);
}

export interface RecentVerdictNote {
  worktree: string;
  reason: string;
  note: string;
  ts: string;
  files?: string[];
}

/**
 * Most recent gate notes with actual text, ANY verdict (spec §2 knowledge-
 * accumulation extra) — unlike byReasonCode (fail-only KPI), a pass-adequate
 * note still carries signal ("worked around X"). Sorted newest first, capped
 * at `limit`.
 *
 * `limit` is a collection cap, not a display cap: callers filter this list
 * (by worktree, by files[]) and slice it themselves, so pass enough to filter
 * over — see the getStatsData call site.
 */
function getRecentVerdictNotes(
  runs: Run[],
  events: Event[],
  limit = 3,
): RecentVerdictNote[] {
  const wtByRun = new Map(runs.map((r) => [r.id, r.worktree]));
  const out: RecentVerdictNote[] = [];
  // events is oldest→first per typical read order; walk backwards for recency.
  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i];
    if (e.kind !== "gate") continue;
    const reason = eventReasonCode(e.data);
    if (!reason) continue; // no recognizable reason_code
    let note = "";
    try {
      const d = JSON.parse(e.data ?? "{}") as { note?: unknown };
      if (typeof d.note === "string") note = d.note;
    } catch {
      // unparseable — skip note text, keep looking
    }
    note = note.replace(/^\[[a-z_]+\]\s*/, "").trim();
    if (!note) continue; // no free-text note beyond the reason_code tag
    // Extract files[] stored in gate event data (added by step 3 of
    // PLAN-loop-and-savings). When present, enables file-scoped filtering
    // in project_health_context.
    let files: string[] | undefined;
    try {
      const d2 = JSON.parse(e.data ?? "{}") as { files?: unknown };
      if (Array.isArray(d2.files) && d2.files.length > 0) {
        files = d2.files.filter((f): f is string => typeof f === "string");
      }
    } catch {
      // no files field — that's fine
    }
    out.push({
      worktree: wtByRun.get(e.run_id) ?? "(unknown)",
      reason,
      note,
      ts: e.ts,
      ...(files ? { files } : {}),
    });
    if (out.length >= limit) break;
  }
  return out;
}

/** Per-plan totals with pass + escalation counts. */
export function getPlanBreakdown(
  runs: Run[],
  maxRounds: number,
): PlanBreakdown[] {
  const map = new Map<
    string,
    { runs: number; passed: number; escalated: number; worktrees: Set<string> }
  >();
  for (const r of runs) {
    const plan = r.plan ?? "(no plan)";
    let b = map.get(plan);
    if (!b) {
      b = { runs: 0, passed: 0, escalated: 0, worktrees: new Set() };
      map.set(plan, b);
    }
    b.runs++;
    if (r.status === "passed") b.passed++;
    if (r.round > maxRounds) b.escalated++;
    b.worktrees.add(r.worktree);
  }
  return [...map.entries()]
    .map(([plan, b]) => ({
      plan,
      runs: b.runs,
      passed: b.passed,
      escalated: b.escalated,
      worktrees: [...b.worktrees].sort(),
    }))
    .sort((a, b) => b.runs - a.runs);
}

/** Runs past the round cap — plan-quality signal, not code (CLAUDE.md #2). */
function getEscalatedRuns(runs: Run[], maxRounds: number): EscalatedRun[] {
  return runs
    .filter((r) => r.round > maxRounds)
    .map((r) => ({
      id: r.id,
      worktree: r.worktree,
      plan: r.plan,
      round: r.round,
    }))
    .sort((a, b) => a.id - b.id);
}

/** Plans that passed at round 1 — worth reusing as a template (spec §2). */
function getBestPassing(runs: Run[], events: Event[]): BestPassing[] {
  const passRunIds = new Set<number>();
  for (const e of events) {
    if (e.kind !== "gate" || !e.data) continue;
    try {
      const d = JSON.parse(e.data) as { verdict?: unknown };
      if (
        typeof d.verdict === "string" &&
        (d.verdict === "pass" || d.verdict.startsWith("pass-"))
      )
        passRunIds.add(e.run_id);
    } catch {
      // unparseable — skip
    }
  }
  return runs
    .filter((r) => r.round <= 1 && r.plan !== null && passRunIds.has(r.id))
    .map((r) => ({ plan: r.plan as string, worktree: r.worktree }))
    .sort((a, b) => (a.plan < b.plan ? -1 : 1));
}

export interface StatsData {
  /** Worktree these numbers describe; null = every project in the db. */
  scope: string | null;
  runs: {
    total: number;
    byStatus: Record<string, number>;
    passRate: number;
    stallRate: number;
    avgRounds: number;
    avgMinutes: number;
  };
  stages: {
    exec: { avg: number; count: number };
    review: { avg: number; count: number };
  };
  byModel: Array<{
    worktree: string;
    client: string;
    provider: string;
    model: string;
    agent: string;
    gateCount: number;
    /** Non-pass-family verdicts in this bucket. */
    fails: number;
    /** fails / gateCount — the per-model question nothing else can answer. */
    failRate: number;
    avgQuality: number;
    /** Total input tokens across sessions attributed to this model (null when none recorded). */
    tokensInput: number | null;
    /** Total output tokens across sessions attributed to this model (null when none recorded). */
    tokensOutput: number | null;
    /** Pass-family gates in this bucket — denominator for tokensPerPass. */
    passes: number;
    /** (tokensInput + tokensOutput) / passes — null when passes=0 or no tokens. */
    tokensPerPass: number | null;
  }>;
  /** How many gates got their model by inference vs. a declared session_id. */
  modelAttribution: { inferred: number; declared: number; none: number };
  byGrade: Array<{
    grade: string;
    count: number;
  }>;
  byWorktree: Array<{
    worktree: string;
    runs: number;
    passed: number;
    stalled: number;
    /** Un-shipped plan files in that repo's planDir, or null when uncountable. */
    pending: number | null;
  }>;
  /** Cross-run knowledge (PLAN-project-health-context §2) — additive, always present. */
  byReasonCode: ReasonCodeCount[];
  byPlan: PlanBreakdown[];
  escalatedRuns: EscalatedRun[];
  bestPassing: BestPassing[];
  recentVerdictNotes: RecentVerdictNote[];
  /** Per-file gate/fail counts (risk heatmap), worst first. */
  byFile: FileRisk[];
  /** planned vs dove-in split: plan != null → planned, plan == null → no-plan. */
  byPlanMode: Array<{
    worktree: string;
    hasPlan: boolean;
    model: string;
    gates: number;
    fails: number;
    failRate: number;
    avgQuality: number;
    tokensInput: number | null;
    tokensOutput: number | null;
    /** Pass-family gates in this bucket — denominator for tokensPerPass. */
    passes: number;
    /** (tokensInput + tokensOutput) / passes — null when passes=0 or no tokens. */
    tokensPerPass: number | null;
  }>;
  /** regime × model split (old gates with no regime sit in the "—" row). */
  byRegime: Array<{
    worktree: string;
    regime: string;
    model: string;
    gates: number;
    fails: number;
    failRate: number;
    avgQuality: number;
    tokensInput: number | null;
    tokensOutput: number | null;
    /** Pass-family gates in this bucket — denominator for tokensPerPass. */
    passes: number;
    /** (tokensInput + tokensOutput) / passes — null when passes=0 or no tokens. */
    tokensPerPass: number | null;
  }>;
  usage: PassiveUsageResult;
  /** ZCode passive usage (when ~/.zcode/cli/db/db.sqlite exists). */
  zcodeUsage?: PassiveUsageResult | null;
  /** Claude Code passive usage (when ~/.claude/projects/ exists). */
  claudeCodeUsage?: PassiveUsageResult | null;
  /** Codex passive usage (when ~/.codex/sessions/ exists). */
  codexUsage?: PassiveUsageResult | null;
  /** ISO timestamp of the most recent run creation (for freshness display). */
  latestRunAt: string;
}

/**
 * Charge a gate its share of its session's token total: 1/N, N = that
 * session's gate count.
 *
 * Tokens are a per-session total and one session routinely produces several
 * gates (measured here: 35 sessions behind 58 gates, up to 5 in one), so
 * summing the full total per gate would multiply it by the gate count.
 * Charging it once per bucket instead — what this did until 2026-09-19 — is
 * right within one table and wrong across tables: a session spanning several
 * regimes charged its whole total to every regime it touched. Measured then,
 * claude-opus-5 totalled 218.5M input in by-model while its five by-regime
 * rows summed to 847M (3.9x), and the inflation scaled with how many regimes
 * a model was used in — so `--mode verdict` ranked the broadly-used models as
 * the expensive ones. Shares sum back to the session total in every table,
 * which is why by-model is unchanged by this: one session is one model, so
 * its N shares land in a single bucket.
 */
function addGateTokenShare(
  bucket: { tokensInput: number; tokensOutput: number },
  g: {
    sessionId: string | null;
    tokensInput: number | null;
    tokensOutput: number | null;
  },
  gatesPerSession: Map<string, number>,
): void {
  if (!g.sessionId) return;
  const n = gatesPerSession.get(g.sessionId) ?? 1;
  bucket.tokensInput += (g.tokensInput ?? 0) / n;
  bucket.tokensOutput += (g.tokensOutput ?? 0) / n;
}

/**
 * tokens/pass — the visible retry tax (SPEC-cost-per-pass).
 *
 * The divisor is a pass-family gate, not a run: bucket is already a gate, and
 * work "finished" is a gate that passed · token is a per-session total (deduped),
 * not per gate — one session can emit several gates, so summing per gate would
 * multiply unevenly across models.
 *
 * `passes=0` or total token 0 → null (not Infinity/NaN/0): "unmeasurable" is not
 * "free" and never divide by zero · no cost/pass in v1 — no cache split
 * (tokensInput is fresh+cache_read+cache_write), so price needs a guess.
 */
function tokensPerPass(
  passes: number,
  tokensInput: number,
  tokensOutput: number,
): number | null {
  if (passes <= 0) return null;
  const total = tokensInput + tokensOutput;
  return total > 0 ? total / passes : null;
}

/**
 * KPIs across runs, scoped to one worktree unless `worktree` is omitted.
 *
 * Scoping happens here, at the source, rather than per table: every downstream
 * number (pass rate, by-model, regime, plan mode) then agrees on which runs it
 * is describing. Mixing projects silently is the failure mode worth designing
 * against — a TS/React app and a Bun CLI are different work, and an average
 * over both answers a question nobody asked while looking like it answered
 * "in this project". Callers pass the scope; `null` worktree means all of them
 * and is reported as such (see `scope` on the returned object).
 */
export function getStatsData(worktree?: string): StatsData {
  const db = openDb();
  try {
    const runs = (
      worktree
        ? db
            .prepare("SELECT * FROM runs WHERE worktree = ? ORDER BY id")
            .all(worktree)
        : db.prepare("SELECT * FROM runs ORDER BY id").all()
    ) as Run[];
    const runIds = new Set(runs.map((r) => r.id));
    const events = (
      db.prepare("SELECT * FROM events ORDER BY run_id, id").all() as Event[]
    ).filter((e) => !worktree || runIds.has(e.run_id));

    // --- Runs summary ---
    const byStatus: Record<string, number> = {};
    for (const r of runs) byStatus[r.status] = (byStatus[r.status] ?? 0) + 1;

    // Pass rate is computed from verdicts, not run status. Status is set BY
    // the verdict, so scoring status counted the same fact twice and let
    // ungraded rows distort it: 32 runs from the deleted CLI loop carry no
    // gate at all (see History — kept as a record, not scored), and a `fail`
    // leaves a run non-terminal, so a status-based rate never saw one.
    // Denominator: runs with any verdict. Numerator: those whose LAST
    // verdict is pass-family (a fail that was later fixed counts as passed).
    const lastVerdictByRun = new Map<number, string>();
    for (const e of events) {
      if (e.kind !== "gate" || !e.data) continue;
      try {
        const d = JSON.parse(e.data) as { verdict?: unknown };
        if (typeof d.verdict === "string" && VERDICT_GRADES.has(d.verdict))
          lastVerdictByRun.set(e.run_id, d.verdict);
      } catch {
        // unparseable gate data — not a verdict
      }
    }
    const graded = [...lastVerdictByRun.values()];
    const passed = runs.filter((r) => r.status === "passed");

    const passRate = graded.length
      ? graded.filter((v) => isPassFamily(v)).length / graded.length
      : 0;
    // Stalls are a status-only condition (no verdict is ever submitted for
    // one), so this stays over terminal rows — but only graded ones, so the
    // loop-era rows do not dilute it.
    const terminal = runs.filter(
      (r) =>
        ["passed", "stopped", "stalled"].includes(r.status) &&
        lastVerdictByRun.has(r.id),
    );
    const stallRate = terminal.length
      ? (byStatus.stalled ?? 0) / terminal.length
      : 0;
    const avgRounds = passed.length
      ? passed.reduce((s, r) => s + r.round, 0) / passed.length
      : 0;
    const avgMinutes = passed.length
      ? passed.reduce(
          (s, r) => s + minutesBetween(r.created_at, r.updated_at),
          0,
        ) / passed.length
      : 0;

    // --- Stages ---
    const eventsByRun: Record<number, Event[]> = {};
    for (const e of events) (eventsByRun[e.run_id] ??= []).push(e);

    const execAll: number[] = [];
    const reviewAll: number[] = [];
    for (const es of Object.values(eventsByRun)) {
      const { exec, review } = stageMinutes(es);
      execAll.push(...exec);
      reviewAll.push(...review);
    }

    // --- Gate enrichment ---
    const wtByRun = new Map(runs.map((r) => [r.id, r.worktree]));
    const enriched = enrichGates(events, wtByRun);
    // Denominator for the per-gate token share — see addGateTokenShare.
    const gatesPerSession = new Map<string, number>();
    for (const g of enriched) {
      if (g.sessionId) {
        gatesPerSession.set(
          g.sessionId,
          (gatesPerSession.get(g.sessionId) ?? 0) + 1,
        );
      }
    }

    // Group by worktree+client+provider+model+agent — the same model name on two
    // providers is two different things. Unknown dimension → "—" (never ""
    // or "(unknown)").
    const modelMap: Record<
      string,
      {
        worktree: string;
        client: string;
        provider: string;
        model: string;
        agent: string;
        gateCount: number;
        fails: number;
        passes: number;
        qualities: number[];
        tokensInput: number;
        tokensOutput: number;
      }
    > = {};
    for (const g of enriched) {
      const wt = wtByRun.get(g.runId) ?? "(unknown)";
      const client = g.client ?? "—";
      const provider = g.provider ?? "—";
      const model = g.model ?? "—";
      const agent = g.agent ?? "—";
      const key = [wt, client, provider, model, agent].join("\0");
      const bucket = (modelMap[key] ??= {
        worktree: wt,
        client,
        provider,
        model,
        agent,
        gateCount: 0,
        fails: 0,
        passes: 0,
        qualities: [],
        tokensInput: 0,
        tokensOutput: 0,
      });
      bucket.gateCount++;
      if (g.verdict && !isPassFamily(g.verdict)) bucket.fails++;
      if (g.verdict && isPassFamily(g.verdict)) bucket.passes++;
      const grade = g.verdict as VerdictGrade;
      if (VERDICT_GRADES.has(grade)) bucket.qualities.push(qualityScore(grade));
      addGateTokenShare(bucket, g, gatesPerSession);
    }
    const byModel = Object.values(modelMap)
      .map((b) => ({
        worktree: b.worktree,
        client: b.client,
        provider: b.provider,
        model: b.model,
        agent: b.agent,
        gateCount: b.gateCount,
        fails: b.fails,
        failRate: b.gateCount ? b.fails / b.gateCount : 0,
        avgQuality: b.qualities.length ? avg(b.qualities) : 0,
        tokensInput: b.tokensInput || null,
        tokensOutput: b.tokensOutput || null,
        passes: b.passes,
        tokensPerPass: tokensPerPass(b.passes, b.tokensInput, b.tokensOutput),
      }))
      .sort((a, b) => b.gateCount - a.gateCount);

    const modelAttribution = { inferred: 0, declared: 0, none: 0 };
    for (const g of enriched) {
      if (g.modelSource === "inferred") modelAttribution.inferred++;
      else if (g.modelSource === null) modelAttribution.none++;
      else modelAttribution.declared++;
    }

    const gradeMap: Record<string, number> = {};
    for (const g of enriched) {
      const gr = g.verdict || "(unknown)";
      gradeMap[gr] = (gradeMap[gr] ?? 0) + 1;
    }
    const byGrade = Object.entries(gradeMap)
      .map(([grade, count]) => ({ grade, count }))
      .sort((a, b) => b.count - a.count);

    const wtMap: Record<
      string,
      { runs: number; passed: number; stalled: number }
    > = {};
    for (const r of runs) {
      const b = (wtMap[r.worktree] ??= { runs: 0, passed: 0, stalled: 0 });
      b.runs++;
      if (r.status === "passed") b.passed++;
      if (r.status === "stalled") b.stalled++;
    }
    const byWorktree = Object.entries(wtMap)
      .map(([worktree, b]) => ({
        worktree,
        ...b,
        pending: countPendingPlans(worktree),
      }))
      .sort((a, b) => b.runs - a.runs);

    // --- byPlanMode: planned (has plan) vs dove-in (no plan) × model ---
    const runPlanMap = new Map(runs.map((r) => [r.id, r.plan]));
    const planModeMap: Record<
      string,
      {
        worktree: string;
        hasPlan: boolean;
        model: string;
        gates: number;
        fails: number;
        passes: number;
        qualities: number[];
        tokensInput: number;
        tokensOutput: number;
      }
    > = {};
    for (const g of enriched) {
      const wt = wtByRun.get(g.runId) ?? "(unknown)";
      const hasPlan = (runPlanMap.get(g.runId) ?? null) !== null;
      const model = g.model ?? "—";
      const key = `${wt}\0${hasPlan}\0${model}`;
      const bucket = (planModeMap[key] ??= {
        worktree: wt,
        hasPlan,
        model,
        gates: 0,
        fails: 0,
        passes: 0,
        qualities: [],
        tokensInput: 0,
        tokensOutput: 0,
      });
      bucket.gates++;
      if (g.verdict && !isPassFamily(g.verdict)) bucket.fails++;
      if (g.verdict && isPassFamily(g.verdict)) bucket.passes++;
      const grade = g.verdict as VerdictGrade;
      if (VERDICT_GRADES.has(grade)) bucket.qualities.push(qualityScore(grade));
      addGateTokenShare(bucket, g, gatesPerSession);
    }
    const byPlanMode = Object.values(planModeMap)
      .map((b) => ({
        worktree: b.worktree,
        hasPlan: b.hasPlan,
        model: b.model,
        gates: b.gates,
        fails: b.fails,
        failRate: b.gates ? b.fails / b.gates : 0,
        avgQuality: b.qualities.length ? avg(b.qualities) : 0,
        tokensInput: b.tokensInput || null,
        tokensOutput: b.tokensOutput || null,
        passes: b.passes,
        tokensPerPass: tokensPerPass(b.passes, b.tokensInput, b.tokensOutput),
      }))
      .sort((a, b) => b.gates - a.gates);

    // --- byRegime: regime × model (old gates with no regime → "—" row) ---
    // Pre-compute regime per run from gate events (first valid regime wins).
    const regimeByRun = new Map<number, string>();
    for (const e of events) {
      if (e.kind !== "gate" || !e.data) continue;
      if (regimeByRun.has(e.run_id)) continue;
      try {
        const d = JSON.parse(e.data) as { regime?: unknown };
        if (
          typeof d.regime === "string" &&
          (REGIME_CODES as readonly string[]).includes(d.regime)
        ) {
          regimeByRun.set(e.run_id, d.regime);
        }
      } catch {
        // unparseable — skip
      }
    }
    const regimeMap: Record<
      string,
      {
        worktree: string;
        regime: string;
        model: string;
        gates: number;
        fails: number;
        passes: number;
        qualities: number[];
        tokensInput: number;
        tokensOutput: number;
      }
    > = {};
    for (const g of enriched) {
      const wt = wtByRun.get(g.runId) ?? "(unknown)";
      const regime = regimeByRun.get(g.runId) ?? "—";
      const model = g.model ?? "—";
      const key = `${wt}\0${regime}\0${model}`;
      const bucket = (regimeMap[key] ??= {
        worktree: wt,
        regime,
        model,
        gates: 0,
        fails: 0,
        passes: 0,
        qualities: [],
        tokensInput: 0,
        tokensOutput: 0,
      });
      bucket.gates++;
      if (g.verdict && !isPassFamily(g.verdict)) bucket.fails++;
      if (g.verdict && isPassFamily(g.verdict)) bucket.passes++;
      const grade = g.verdict as VerdictGrade;
      if (VERDICT_GRADES.has(grade)) bucket.qualities.push(qualityScore(grade));
      addGateTokenShare(bucket, g, gatesPerSession);
    }
    const byRegime = Object.values(regimeMap)
      .map((b) => ({
        worktree: b.worktree,
        regime: b.regime,
        model: b.model,
        gates: b.gates,
        fails: b.fails,
        failRate: b.gates ? b.fails / b.gates : 0,
        avgQuality: b.qualities.length ? avg(b.qualities) : 0,
        tokensInput: b.tokensInput || null,
        tokensOutput: b.tokensOutput || null,
        passes: b.passes,
        tokensPerPass: tokensPerPass(b.passes, b.tokensInput, b.tokensOutput),
      }))
      .sort((a, b) => b.gates - a.gates);

    const usage = readPassiveUsage();
    const zcodeUsage = readZcodeUsage();
    const claudeCodeUsage = readClaudeCodeUsage();
    const codexUsage = readCodexUsage();

    const maxRounds = resolveMaxRounds();

    // Latest run creation timestamp (for freshness display in reports)
    const latestRunAt = runs.length
      ? runs.reduce((a, b) => (a.created_at > b.created_at ? a : b)).created_at
      : "";

    return {
      scope: worktree ?? null,
      runs: {
        total: runs.length,
        byStatus,
        passRate,
        stallRate,
        avgRounds,
        avgMinutes,
      },
      stages: {
        exec: { avg: avg(execAll), count: execAll.length },
        review: { avg: avg(reviewAll), count: reviewAll.length },
      },
      byModel,
      modelAttribution,
      byGrade,
      byWorktree,
      byReasonCode: getReasonCodeBreakdown(runs, events),
      byPlan: getPlanBreakdown(runs, maxRounds),
      escalatedRuns: getEscalatedRuns(runs, maxRounds),
      bestPassing: getBestPassing(runs, events),
      // 50, not the display cap of 3: project_health_context filters this
      // list by worktree and files[] before slicing, so a cap of 3 here would
      // throw away the very notes a file-scoped query is looking for.
      recentVerdictNotes: getRecentVerdictNotes(runs, events, 50),
      byFile: getFileRisk(runs, events),
      byPlanMode,
      byRegime,
      usage,
      zcodeUsage: zcodeUsage.session_count > 0 ? zcodeUsage : null,
      claudeCodeUsage:
        claudeCodeUsage.session_count > 0 ? claudeCodeUsage : null,
      codexUsage: codexUsage.session_count > 0 ? codexUsage : null,
      latestRunAt,
    };
  } finally {
    // The MCP server is a long-lived stdio process — polling tools must not
    // leak one SQLite handle per call.
    db.close();
  }
}
