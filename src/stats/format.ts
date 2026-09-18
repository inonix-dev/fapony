// src/stats/format.ts — formatStatsText() for CLI + MCP text mode

import {
  type ImputedModel,
  imputeResult,
  loadPrices,
  type PriceTable,
} from "../price/index.js";
import type { ModelBreakdown, PassiveUsageResult } from "../session/index.js";
import type { StatsData } from "./data.js";

/**
 * One "by model" line. provider is part of the identity, not decoration:
 * OpenCode records the same id under different providers (mimo-v2.5 on
 * opencode-go and on xiaomi are two rows), so printing the id alone renders
 * them as one duplicated-looking model. session_count is printed because a
 * row can legitimately be all zeros — 145 big-pickle sessions recorded no
 * tokens at all — and without it a 0/0 line reads like a parse failure.
 */
/**
 * Input tokens as actually billed. Cache reads and cache writes ARE input —
 * `tokens_input` alone is only the uncached remainder, and printing it renders a
 * coding agent as having read less than it wrote (Claude Code showed 750k in /
 * 64.6M out, which is impossible). The three stay separate in the readers on
 * purpose: they bill at different rates, so pricing needs them apart. Summing
 * belongs here, at the point of display.
 */
function fmtIn(input: number, cacheRead: number, cacheWrite: number): string {
  const cached = cacheRead + cacheWrite;
  const total = input + cached;
  return cached > 0
    ? `${total.toLocaleString()} in (${cached.toLocaleString()} cached)`
    : `${total.toLocaleString()} in`;
}

function modelLine(
  m: ModelBreakdown,
  withCost: boolean,
  imp?: ImputedModel,
): string {
  const name = `${m.provider ? `${m.provider}/` : ""}${m.model || "(no model id)"}`;
  let cost = "";
  if (withCost) cost = ` ($${m.cost.toFixed(4)})`;
  else if (imp && imp.status === "priced")
    cost = ` (~$${imp.imputed_cost.toFixed(4)} list-price)`;
  return (
    `    ${name}: ${m.session_count} sessions, ` +
    `${fmtIn(m.tokens_input, m.tokens_cache_read, m.tokens_cache_write)} / ` +
    `${m.tokens_output.toLocaleString()} out${cost}`
  );
}

/**
 * list-price equivalent line appended to each usage section — the one unit
 * that compares across clients (clients that do not record cost get a price
 * attached here). List price is not money paid · unpriced is broken out
 * separately, never folded into 0.
 */
function imputedLines(
  result: PassiveUsageResult,
  prices: PriceTable | null,
): { map: Map<string, ImputedModel>; lines: string[] } {
  const map = new Map<string, ImputedModel>();
  if (result.session_count === 0) return { map, lines: [] };
  if (!prices) {
    return {
      map,
      lines: [
        `  list-price equivalent: — (run \`fapony price-scan\` to price ${result.session_count} sessions)`,
      ],
    };
  }
  const s = imputeResult(result, prices);
  for (const m of s.by_model) map.set(`${m.provider}\0${m.model}`, m);
  const parts = [
    `~$${s.total_imputed.toFixed(4)} over ${s.priced_sessions} priced sessions`,
  ];
  if (s.free_sessions > 0) parts.push(`${s.free_sessions} free`);
  if (s.unpriced_sessions > 0)
    parts.push(
      `unpriced: ${s.unpriced_sessions} sessions / ${s.unpriced_tokens.toLocaleString()} tokens`,
    );
  return { map, lines: [`  list-price equivalent: ${parts.join(" · ")}`] };
}

function fmtRate(r: number): string {
  return `${(r * 100).toFixed(0)}%`;
}

function fmtTokens(n: number | null): string {
  if (n === null || n === 0) return "—";
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

/** Shorten a worktree path to its basename for table display. */
function shortWt(wt: string): string {
  const parts = wt.replace(/\/$/, "").split("/");
  return parts[parts.length - 1] || wt;
}

export function formatStatsText(data: StatsData): string {
  if (data.runs.total === 0) return "no runs yet";

  const lines: string[] = [];
  // list price from cache only — the query never fetches itself (works
  // offline, missing file = shows — + hint, never throws)
  const prices = loadPrices();

  if (data.scope) {
    lines.push(`scope: ${data.scope}`);
  } else {
    lines.push(`scope: all projects (${data.byWorktree.length})`);
  }

  lines.push(
    `runs: ${data.runs.total}  (${Object.entries(data.runs.byStatus)
      .map(([k, v]) => `${k}=${v}`)
      .join(", ")})`,
  );
  lines.push(
    `pass rate: ${fmtRate(data.runs.passRate)}  stall rate: ${fmtRate(data.runs.stallRate)}`,
  );
  lines.push(
    `avg rounds to pass: ${data.runs.avgRounds.toFixed(1)}  avg time to pass: ${data.runs.avgMinutes.toFixed(0)}m`,
  );

  lines.push(
    `avg exec time (spawn→route): ${data.stages.exec.avg.toFixed(1)}m over ${data.stages.exec.count} rounds`,
  );
  lines.push(
    `avg review turnaround (route→gate): ${data.stages.review.avg.toFixed(1)}m over ${data.stages.review.count} rounds`,
  );

  if (data.byModel.length > 0) {
    const showWt = !data.scope;
    lines.push("\nby model:");
    if (showWt) {
      lines.push(
        "  project | client | provider | model | agent | gates | fails | failRate | tokens/pass | avgQuality | tokens/session",
      );
      lines.push(
        "  ---------|--------|----------|-------|-------|-------|-------|----------|-------------|------------|----------------",
      );
    } else {
      lines.push(
        "  client | provider | model | agent | gates | fails | failRate | tokens/pass | avgQuality | tokens/session",
      );
      lines.push(
        "  -------|----------|-------|-------|-------|-------|----------|-------------|------------|----------------",
      );
    }
    for (const m of data.byModel) {
      const wt = showWt ? `${shortWt(m.worktree).padEnd(9)} | ` : "";
      lines.push(
        `  ${wt}${m.client.padEnd(6)} | ${m.provider.padEnd(8)} | ${m.model.padEnd(5)} | ${m.agent.padEnd(5)} | ${String(m.gateCount).padStart(5)} | ${String(m.fails).padStart(5)} | ${fmtRate(m.failRate).padStart(8)} | ${fmtTokens(m.tokensPerPass).padStart(11)} | ${m.avgQuality.toFixed(1).padStart(10)} | ${fmtTokens(m.tokensInput).padStart(7)} in / ${fmtTokens(m.tokensOutput).padStart(7)} out`,
      );
    }
    const a = data.modelAttribution;
    if (a.inferred > 0 || a.none > 0) {
      lines.push(
        `  attribution: ${a.declared} declared, ${a.inferred} inferred from the live session, ${a.none} unknown`,
      );
    }
  }

  if (data.byPlanMode.length > 0) {
    const showWt = !data.scope;
    lines.push("\nplanned vs dove-in:");
    if (showWt) {
      lines.push(
        "  project | mode     | model | gates | fails | failRate | tokens/pass | avgQuality | tokens/session",
      );
      lines.push(
        "  ---------|----------|-------|-------|-------|----------|-------------|------------|----------------",
      );
    } else {
      lines.push(
        "  mode     | model | gates | fails | failRate | tokens/pass | avgQuality | tokens/session",
      );
      lines.push(
        "  ----------|-------|-------|-------|----------|-------------|------------|----------------",
      );
    }
    for (const r of data.byPlanMode) {
      const mode = r.hasPlan ? "planned" : "no-plan";
      const wt = showWt ? `${shortWt(r.worktree).padEnd(9)} | ` : "";
      lines.push(
        `  ${wt}${mode.padEnd(9)} | ${r.model.padEnd(5)} | ${String(r.gates).padStart(5)} | ${String(r.fails).padStart(5)} | ${fmtRate(r.failRate).padStart(8)} | ${fmtTokens(r.tokensPerPass).padStart(11)} | ${r.avgQuality.toFixed(1).padStart(10)} | ${fmtTokens(r.tokensInput).padStart(7)} in / ${fmtTokens(r.tokensOutput).padStart(7)} out`,
      );
    }
  }

  if (data.byRegime.length > 0) {
    const showWt = !data.scope;
    lines.push("\nby regime:");
    if (showWt) {
      lines.push(
        "  project | regime | model | gates | fails | failRate | tokens/pass | avgQuality | tokens/session",
      );
      lines.push(
        "  ---------|--------|-------|-------|-------|----------|-------------|------------|----------------",
      );
    } else {
      lines.push(
        "  regime | model | gates | fails | failRate | tokens/pass | avgQuality | tokens/session",
      );
      lines.push(
        "  --------|-------|-------|-------|-------|----------|-------------|------------|----------------",
      );
    }
    for (const r of data.byRegime) {
      const wt = showWt ? `${shortWt(r.worktree).padEnd(9)} | ` : "";
      lines.push(
        `  ${wt}${r.regime.padEnd(7)} | ${r.model.padEnd(5)} | ${String(r.gates).padStart(5)} | ${String(r.fails).padStart(5)} | ${fmtRate(r.failRate).padStart(8)} | ${fmtTokens(r.tokensPerPass).padStart(11)} | ${r.avgQuality.toFixed(1).padStart(10)} | ${fmtTokens(r.tokensInput).padStart(7)} in / ${fmtTokens(r.tokensOutput).padStart(7)} out`,
      );
    }
  }

  if (data.byGrade.length > 0) {
    lines.push("\nby grade:");
    lines.push("  grade | count");
    lines.push("  ------|------");
    for (const g of data.byGrade) {
      lines.push(`  ${g.grade.padEnd(14)} | ${String(g.count).padStart(5)}`);
    }
  }

  if (data.byWorktree.length > 0) {
    lines.push("\nby worktree:");
    lines.push("  worktree | runs | passed | stalled | pending");
    lines.push("  ---------|------|--------|---------|--------");
    for (const w of data.byWorktree) {
      const pending = w.pending === null ? "—" : String(w.pending);
      lines.push(
        `  ${w.worktree.padEnd(8)} | ${String(w.runs).padStart(4)} | ${String(w.passed).padStart(6)} | ${String(w.stalled).padStart(7)} | ${pending.padStart(7)}`,
      );
    }
  }

  if (data.byReasonCode.length > 0) {
    lines.push("\nby reason_code (non-pass gates only):");
    lines.push("  worktree | reason | count");
    lines.push("  ---------|--------|------");
    for (const r of data.byReasonCode.slice(0, 3)) {
      lines.push(
        `  ${r.worktree.padEnd(8)} | ${r.reason.padEnd(14)} | ${String(r.count).padStart(5)}`,
      );
    }
  }

  if (data.byFile.length > 0) {
    lines.push(
      "\nby file (graded touches — absence means unmeasured, not safe):",
    );
    lines.push("  file | gates | fails | last reason");
    lines.push("  -----|-------|-------|------------");
    for (const f of data.byFile.slice(0, 10)) {
      lines.push(
        `  ${f.file.padEnd(40)} | ${String(f.gates).padStart(5)} | ${String(f.fails).padStart(5)} | ${f.lastReason ?? "—"}`,
      );
    }
  }

  if (data.escalatedRuns.length > 0) {
    lines.push("\nescalated runs (round past cap — likely plan signal):");
    for (const e of data.escalatedRuns.slice(0, 3)) {
      lines.push(
        `  run ${e.id} (${e.worktree}, plan ${e.plan ?? "—"}): round ${e.round}`,
      );
    }
  }

  if (data.bestPassing.length > 0) {
    lines.push("\nplans passed at round 1 (reuse this shape):");
    for (const b of data.bestPassing.slice(0, 3)) {
      lines.push(`  ${b.plan} (${b.worktree})`);
    }
  }

  if (data.usage.session_count > 0) {
    lines.push("\nusage:");
    lines.push(
      `  total: ${fmtIn(data.usage.total_tokens_input, data.usage.total_tokens_cache_read, data.usage.total_tokens_cache_write)} / ${data.usage.total_tokens_output.toLocaleString()} out / ${data.usage.total_tokens_reasoning.toLocaleString()} reasoning tokens over ${data.usage.session_count} sessions ($${data.usage.total_cost.toFixed(4)})`,
    );
    if (data.usage.by_model.length > 0) {
      lines.push("  by model:");
      for (const m of data.usage.by_model) lines.push(modelLine(m, true));
    }
    lines.push(...imputedLines(data.usage, prices).lines);
  }

  // ZCode usage (separate DB)
  if (data.zcodeUsage && data.zcodeUsage.session_count > 0) {
    const zu = data.zcodeUsage;
    lines.push("\nzcode usage:");
    lines.push(
      `  total: ${fmtIn(zu.total_tokens_input, zu.total_tokens_cache_read, zu.total_tokens_cache_write)} / ${zu.total_tokens_output.toLocaleString()} out / ${zu.total_tokens_reasoning.toLocaleString()} reasoning tokens over ${zu.session_count} sessions`,
    );
    if (zu.by_model.length > 0) {
      const imp = imputedLines(zu, prices);
      lines.push("  by model:");
      for (const m of zu.by_model)
        lines.push(
          modelLine(m, false, imp.map.get(`${m.provider}\0${m.model}`)),
        );
      lines.push(...imp.lines);
    } else {
      lines.push(...imputedLines(zu, prices).lines);
    }
  }

  // Claude Code usage (JSONL files)
  if (data.claudeCodeUsage && data.claudeCodeUsage.session_count > 0) {
    const cc = data.claudeCodeUsage;
    lines.push("\nclaude code usage:");
    lines.push(
      `  total: ${fmtIn(cc.total_tokens_input, cc.total_tokens_cache_read, cc.total_tokens_cache_write)} / ${cc.total_tokens_output.toLocaleString()} out / ${cc.total_tokens_reasoning.toLocaleString()} reasoning tokens over ${cc.session_count} sessions`,
    );
    if (cc.by_model.length > 0) {
      const imp = imputedLines(cc, prices);
      lines.push("  by model:");
      for (const m of cc.by_model)
        lines.push(
          modelLine(m, false, imp.map.get(`${m.provider}\0${m.model}`)),
        );
      lines.push(...imp.lines);
    } else {
      lines.push(...imputedLines(cc, prices).lines);
    }
  }

  // Codex usage (JSONL files)
  if (data.codexUsage && data.codexUsage.session_count > 0) {
    const cx = data.codexUsage;
    lines.push("\ncodex usage:");
    lines.push(
      `  total: ${fmtIn(cx.total_tokens_input, cx.total_tokens_cache_read, cx.total_tokens_cache_write)} / ${cx.total_tokens_output.toLocaleString()} out / ${cx.total_tokens_reasoning.toLocaleString()} reasoning tokens over ${cx.session_count} sessions`,
    );
    if (cx.by_model.length > 0) {
      const imp = imputedLines(cx, prices);
      lines.push("  by model:");
      for (const m of cx.by_model)
        lines.push(
          modelLine(m, false, imp.map.get(`${m.provider}\0${m.model}`)),
        );
      lines.push(...imp.lines);
    } else {
      lines.push(...imputedLines(cx, prices).lines);
    }
  }

  return lines.join("\n");
}

// --- Verdict mode: Pareto frontier of quality vs tokens/pass ---

/** One model's record inside a single regime. */
export interface VerdictRow {
  model: string;
  gates: number;
  fails: number;
  avgQuality: number;
  tokensPerPass: number | null;
}

export interface FrontierRow extends VerdictRow {
  n: number;
}

interface DominatedRow extends VerdictRow {
  dominator: string;
  tokenRatio: number;
  n: number;
}

/** Below this many gates a model is a candidate, not a yardstick. */
const MIN_N = 5;

/** Every regime the ledger accepts — so "never graded" is visible, not absent. */
const REGIMES = ["code", "fix", "review", "plan", "inquiry", "test"];

const withN = (r: VerdictRow): FrontierRow => ({ ...r, n: r.gates });

/** Cheapest first; quality breaks ties. */
const byTokens = (a: VerdictRow, b: VerdictRow) =>
  (a.tokensPerPass ?? 0) - (b.tokensPerPass ?? 0) ||
  b.avgQuality - a.avgQuality;

const hasTokens = (r: VerdictRow) =>
  r.tokensPerPass !== null && r.tokensPerPass > 0;

/**
 * Pareto frontier over (quality up, tokens/pass down), computed from models
 * with n >= MIN_N only.
 *
 * Thin rows are listed separately and never dominate anyone. Without that
 * split one lucky run redefines a whole regime: a model tried once at q4.0
 * dominated nine established models here, including one with n=17.
 */
export function computeFrontier(
  rows: VerdictRow[],
  minN = MIN_N,
): {
  frontier: FrontierRow[];
  dominated: DominatedRow[];
  candidates: FrontierRow[];
  unranked: FrontierRow[];
} {
  const unranked = rows.filter((r) => !hasTokens(r)).map(withN);
  const candidates = rows
    .filter((r) => hasTokens(r) && r.gates < minN)
    .sort(byTokens)
    .map(withN);
  const ranked = rows
    .filter((r) => hasTokens(r) && r.gates >= minN)
    .sort(byTokens);

  const frontier: FrontierRow[] = [];
  let maxQuality = -1;
  for (const r of ranked) {
    if (r.avgQuality > maxQuality) {
      frontier.push(withN(r));
      maxQuality = r.avgQuality;
    }
  }

  const onFrontier = new Set(frontier.map((f) => f.model));
  const dominated: DominatedRow[] = [];
  for (const r of ranked) {
    if (onFrontier.has(r.model)) continue;
    let dominator: string | null = null;
    let tokenRatio = Infinity;
    for (const f of frontier) {
      if (r.avgQuality > f.avgQuality) continue;
      if (r.tokensPerPass! <= f.tokensPerPass!) continue;
      const ratio = r.tokensPerPass! / f.tokensPerPass!;
      if (ratio < tokenRatio) {
        tokenRatio = ratio;
        dominator = f.model;
      }
    }
    if (dominator) dominated.push({ ...r, dominator, tokenRatio, n: r.gates });
  }

  return { frontier, dominated, candidates, unranked };
}

/** `stealth/union-alpha   q3.2  673.8k/pass  n=5` */
function modelRow(r: FrontierRow): string {
  return `  ${r.model.padEnd(35)} q${r.avgQuality.toFixed(1)}  ${fmtTokens(r.tokensPerPass)}/pass  n=${r.n}`;
}

/** The model to reach for, plus what the cheaper end of the frontier costs. */
function pick(frontier: FrontierRow[], closest: FrontierRow | null): string {
  if (frontier.length === 0) {
    return closest
      ? `— no model at n≥${MIN_N} yet (closest: ${closest.model}, n=${closest.n})`
      : `— no model has token attribution yet`;
  }
  const best = frontier[frontier.length - 1]!; // built cheapest-first, quality rising
  const cheapest = frontier[0]!;
  const line = `${best.model}  q${best.avgQuality.toFixed(1)}  ${fmtTokens(best.tokensPerPass)}/pass  n=${best.n}`;
  return cheapest.model === best.model
    ? line
    : `${line}  · cheapest: ${cheapest.model} q${cheapest.avgQuality.toFixed(1)} ${fmtTokens(cheapest.tokensPerPass)}`;
}

/**
 * Render verdict mode: which model to pay for, per regime, ranked on the
 * Pareto frontier of quality vs tokens/pass.
 *
 * Without `regime` it is one line per regime. With one, it is that regime's
 * full frontier / dominated / candidates breakdown.
 *
 * Pass rate is deliberately not the ranking axis — self-graded work passes
 * almost always, so the footer reports fails rather than ranking on them.
 */
export function formatVerdictText(data: StatsData, regime?: string): string {
  if (data.runs.total === 0) return "no runs yet";

  const scope = data.scope ?? "all projects";
  const groups = new Map<string, VerdictRow[]>();
  for (const r of data.byRegime) {
    if (r.model === "—") continue; // unattributed: cannot be ranked
    if (regime && r.regime !== regime) continue;
    const g = groups.get(r.regime) ?? [];
    g.push({
      model: r.model,
      gates: r.gates,
      fails: r.fails,
      avgQuality: r.avgQuality,
      tokensPerPass: r.tokensPerPass,
    });
    groups.set(r.regime, g);
  }

  const sum = (rows: VerdictRow[], key: "gates" | "fails") =>
    rows.reduce((s, r) => s + r[key], 0);
  const closestToN = (rows: VerdictRow[]) =>
    rows
      .filter(hasTokens)
      .map(withN)
      .sort((a, b) => b.n - a.n)[0] ?? null;

  // --- one regime: the full breakdown ---
  if (regime) {
    const rows = groups.get(regime);
    if (!rows || rows.length === 0) {
      return `regime=${regime} · ${scope} · no graded work yet`;
    }
    const gates = sum(rows, "gates");
    const { frontier, dominated, candidates, unranked } = computeFrontier(rows);
    const lines = [
      `regime=${regime} · ${scope} · ${gates} gates · ${rows.length} models`,
    ];

    if (frontier.length > 0) {
      lines.push(
        `\nfrontier (n≥${MIN_N}) — nothing beats these on both quality and tokens:`,
      );
      for (const f of [...frontier].reverse()) lines.push(modelRow(f));
    } else {
      lines.push(`\n${pick(frontier, closestToN(rows))}`);
    }

    if (rows.length === 1) {
      lines.push(
        "  — no comparison yet (only one model graded in this regime)",
      );
    }

    if (dominated.length > 0) {
      lines.push("\ndominated:");
      for (const d of dominated) {
        lines.push(
          `${modelRow(d)}  ← ${d.dominator} dominates, ${d.tokenRatio.toFixed(1)}× tokens`,
        );
      }
    }

    if (candidates.length > 0) {
      lines.push(
        `\ncandidates (n<${MIN_N} — shown, but never used as the yardstick):`,
      );
      for (const c of candidates) lines.push(modelRow(c));
    }

    if (unranked.length > 0) {
      lines.push("\nno token attribution — cannot be ranked:");
      for (const u of unranked) {
        lines.push(
          `  ${u.model.padEnd(35)} q${u.avgQuality.toFixed(1)}  n=${u.n}`,
        );
      }
    }

    lines.push(
      `\nfails: ${sum(rows, "fails")}/${gates} — pass/fail carries no signal here; ranking is quality × tokens`,
    );
    return lines.join("\n");
  }

  // --- all regimes: one line each ---
  const allRows = [...groups.values()].flat();
  const lines = [
    `${scope} · ${sum(allRows, "gates")} gates · ${sum(allRows, "fails")} fails`,
    "",
  ];
  for (const reg of REGIMES) {
    const rows = groups.get(reg);
    const label = `  ${reg.padEnd(8)} ${`(${rows ? sum(rows, "gates") : 0})`.padStart(5)}`;
    if (!rows || rows.length === 0) {
      lines.push(`${label}  — no graded work`);
      continue;
    }
    const { frontier } = computeFrontier(rows);
    lines.push(`${label}  ${pick(frontier, closestToN(rows))}`);
  }
  lines.push(
    `\n(fapony stats --mode verdict --regime <name> for the breakdown)`,
  );
  return lines.join("\n");
}
