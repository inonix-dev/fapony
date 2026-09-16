// src/context/projectHealth.ts — project-health context block builder
//
// Composes the cross-run knowledge queries (PLAN-project-health-context §2)
// into a short plain-text block fed to `plan-with-pony` as "known patterns"
// before drafting. Framed as "watch for", never "must follow" (overfitting
// guard — PLAN §5). Pure function over StatsData: no DB, no I/O.

import type { StatsData } from "../stats/data.js";

export interface HealthContextOptions {
  /** Scope to one worktree path. Global across worktrees when omitted. */
  worktree?: string;
  /** Max reason_code rows (default 3 — PLAN §5 escape hatch against prompt bloat). */
  topReasons?: number;
  /** Min runs before trends are reported (default 5 — PLAN §5 sample-size guard). */
  minRuns?: number;
  /** Filter recentVerdictNotes to only those mentioning these files. */
  files?: string[];
  /**
   * Project decisions from the mem log, surfaced first. Reading the log is I/O,
   * so it happens in the tool handler — this builder stays pure over its inputs.
   */
  memDecisions?: MemDecision[];
}

/** One mem-log decision distilled for the block. */
export interface MemDecision {
  text: string;
  spec?: string;
}

/** Best-scoring model for one regime, from real graded work. */
export interface ModelFit {
  regime: string;
  model: string;
  gates: number;
  failRate: number;
  avgQuality: number;
  tokensPerPass: number | null;
}

// Model right-sizing: below this many graded touches a bucket is noise, not a
// recommendation (same sample-size guard the trend lines use).
const MIN_MODEL_FIT_N = 5;
// Most regimes are 4 (code|fix|review|plan); cap protects the 15-line budget.
const MAX_MODEL_FIT = 4;
// Mem decisions shown ahead of the less-specific lines below.
const MEM_DECISION_MAX = 3;
const MEM_DECISION_CHARS = 140;

function fmtShortTokens(n: number): string {
  return n >= 1000 ? `${Math.round(n / 1000)}k` : `${Math.round(n)}`;
}

function truncate(s: string, max: number): string {
  return s.length <= max ? s : `${s.slice(0, max - 1)}…`;
}

/**
 * Pick the best model per regime from real graded work. "Best" = fewest fails
 * first (the thing that costs a rework), then cheapest tokens/pass, then
 * highest quality. Buckets under `minN` are skipped — one lucky verdict is not
 * a recommendation; regimes with no eligible bucket drop out entirely.
 */
export function computeModelFit(
  byRegime: StatsData["byRegime"],
  worktree?: string,
  minN = MIN_MODEL_FIT_N,
): ModelFit[] {
  const eligible = byRegime.filter(
    (r) =>
      r.regime !== "—" &&
      r.model !== "—" &&
      r.gates >= minN &&
      (worktree ? r.worktree === worktree : true),
  );

  const byName = new Map<string, ModelFit[]>();
  for (const r of eligible) {
    const list = byName.get(r.regime) ?? [];
    list.push({
      regime: r.regime,
      model: r.model,
      gates: r.gates,
      failRate: r.failRate,
      avgQuality: r.avgQuality,
      tokensPerPass: r.tokensPerPass,
    });
    byName.set(r.regime, list);
  }

  const out: ModelFit[] = [];
  for (const list of byName.values()) {
    list.sort((a, b) => {
      if (a.failRate !== b.failRate) return a.failRate - b.failRate;
      const at = a.tokensPerPass ?? Number.POSITIVE_INFINITY;
      const bt = b.tokensPerPass ?? Number.POSITIVE_INFINITY;
      if (at !== bt) return at - bt;
      return b.avgQuality - a.avgQuality;
    });
    out.push(list[0]);
  }
  return out.slice(0, MAX_MODEL_FIT);
}

/**
 * Build the "known patterns" block (spec §3 shape, capped ~15 lines).
 * Low-history scopes get an explicit "not enough history yet" line instead
 * of noise from n=1 patterns looking like trends.
 */
export function buildProjectHealthContext(
  data: StatsData,
  opts?: HealthContextOptions,
): string {
  const worktree = opts?.worktree;
  const topReasons = opts?.topReasons ?? 3;
  const minRuns = opts?.minRuns ?? 5;
  const files = opts?.files;

  const total = worktree
    ? (data.byWorktree.find((w) => w.worktree === worktree)?.runs ?? 0)
    : data.runs.total;
  const scope = worktree ?? "all worktrees";
  const header = `## Known patterns for this project (from fapony history, N=${total} runs, ${scope})`;

  // Lead with the two things no code-exploration tool can produce: what this
  // project already decided (mem) and which model actually holds up for each
  // task shape (the ledger). Everything below is the older, weaker watch-fors.
  const lead: string[] = [];
  const memDecisions = (opts?.memDecisions ?? []).slice(0, MEM_DECISION_MAX);
  if (memDecisions.length > 0) {
    const list = memDecisions
      .map((d) => `"${truncate(d.text, MEM_DECISION_CHARS)}"`)
      .join(" · ");
    lead.push(`- Decisions on record (mem): ${list}`);
  }
  for (const f of computeModelFit(data.byRegime, worktree)) {
    const bits = [
      `failRate ${Math.round(f.failRate * 100)}%`,
      `quality ${f.avgQuality.toFixed(1)}`,
      `N=${f.gates}`,
    ];
    if (f.tokensPerPass !== null) {
      bits.push(`${fmtShortTokens(f.tokensPerPass)} tok/pass`);
    }
    lead.push(
      `- Model fit: regime=${f.regime} → ${f.model} (${bits.join(", ")})`,
    );
  }

  // Recent free-text notes carry signal from N=1 (a specific "worked around
  // X" beats a count) — unlike the trend lines below, not gated by minRuns.
  // Order matters: filter (worktree, then files) BEFORE slicing, so a match
  // sitting past the top-3 cutoff still surfaces when files[] is given.
  let notes = worktree
    ? data.recentVerdictNotes.filter((n) => n.worktree === worktree)
    : data.recentVerdictNotes;
  // When files[] is provided, keep only notes that mention at least one of
  // the target files (substring match on note text or stored files array).
  if (files && files.length > 0) {
    const fileSet = new Set(files.map((f) => f.toLowerCase()));
    notes = notes.filter((n) => {
      // Check stored files array first (reliable, from gate event data).
      if (n.files && n.files.length > 0) {
        return n.files.some((f) => fileSet.has(f.toLowerCase()));
      }
      // Fallback: substring match on note text.
      const noteLower = n.note.toLowerCase();
      return files.some((f) => noteLower.includes(f.toLowerCase()));
    });
  }
  notes = notes.slice(0, 3);

  // File risk for exactly the files being touched. Unlike the trend lines
  // below this is NOT gated by minRuns: "this file failed last time" is
  // actionable at n=1, and the count is printed so the reader can weigh it.
  let riskLine: string | null = null;
  if (files && files.length > 0) {
    const fileSet = new Set(files.map((f) => f.toLowerCase()));
    const hits = data.byFile
      .filter((f) => (worktree ? f.worktree === worktree : true))
      .filter((f) => f.fails > 0 && fileSet.has(f.file.toLowerCase()))
      .slice(0, 3);
    if (hits.length > 0) {
      riskLine = `- Files you are touching that failed before: ${hits
        .map(
          (h) =>
            `${h.file} (${h.fails}/${h.gates} graded touches failed${h.lastReason ? `, last: ${h.lastReason}` : ""})`,
        )
        .join(" · ")}`;
    }
  }

  if (total < minRuns) {
    const lines = [
      header,
      ...lead,
      `- Not enough history yet (${total} runs, need ${minRuns}+) for recurring patterns; draft freely.`,
    ];
    if (riskLine) lines.push(riskLine);
    if (notes.length > 0) {
      lines.push(
        `- Recent verdict notes: ${notes.map((n) => `[${n.reason}] ${n.note}`).join(" · ")}`,
      );
    }
    return lines.slice(0, 15).join("\n");
  }

  const reasons = (
    worktree
      ? data.byReasonCode.filter((r) => r.worktree === worktree)
      : data.byReasonCode
  ).slice(0, Math.max(topReasons, 0));
  const escalated = worktree
    ? data.escalatedRuns.filter((e) => e.worktree === worktree)
    : data.escalatedRuns;
  const passing = (
    worktree
      ? data.bestPassing.filter((b) => b.worktree === worktree)
      : data.bestPassing
  ).slice(0, 3);

  const lines = [header, ...lead];
  if (riskLine) lines.push(riskLine);
  if (reasons.length > 0) {
    const list = reasons.map((r) => `${r.reason} (${r.count}×)`).join(", ");
    lines.push(
      `- Recurring fail reasons (non-pass gates): ${list} — watch for these in the new plan.`,
    );
  }
  if (escalated.length > 0) {
    // Top-1 concrete example only (PLAN §5: never dump full history).
    const ex = escalated[0];
    const planBit = ex.plan
      ? ` (e.g. plan "${ex.plan}", round ${ex.round})`
      : "";
    lines.push(
      `- ${escalated.length} run${escalated.length === 1 ? "" : "s"} escalated past the round cap${planBit} — likely the plan was underspecified, not the code.`,
    );
  }
  if (passing.length > 0) {
    const list = passing.map((b) => `"${b.plan}"`).join(", ");
    lines.push(
      `- Passed round 1 before: ${list} — shapes worth reusing when they fit.`,
    );
  }
  if (notes.length > 0) {
    lines.push(
      `- Recent verdict notes: ${notes.map((n) => `[${n.reason}] ${n.note}`).join(" · ")}`,
    );
  }
  if (lines.length === 1) {
    lines.push(
      "- No recurring failure or escalation patterns observed — draft freely, keep the scope tight.",
    );
  }
  return lines.slice(0, 15).join("\n");
}
