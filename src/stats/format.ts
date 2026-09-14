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
 * บรรทัด list-price equivalent ต่อท้ายแต่ละ usage section — หน่วยเดียวที่
 * เทียบข้าม client ได้ (client ที่ไม่บันทึก cost มีราคาติดตรงนี้)
 * ราคา list ไม่ใช่เงินที่จ่ายจริง · unpriced แยกออกมาให้เห็น ไม่รวมใน 0
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
  // ราคา list จาก cache อย่างเดียว — query ไม่ fetch เอง (offline ได้, ไม่มี
  // ไฟล์ = แสดง — + hint ไม่ throw)
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
        "  project | client | provider | model | agent | gates | fails | failRate | avgQuality | tokens/session",
      );
      lines.push(
        "  ---------|--------|----------|-------|-------|-------|-------|----------|------------|----------------",
      );
    } else {
      lines.push(
        "  client | provider | model | agent | gates | fails | failRate | avgQuality | tokens/session",
      );
      lines.push(
        "  -------|----------|-------|-------|-------|-------|----------|------------|----------------",
      );
    }
    for (const m of data.byModel) {
      const wt = showWt ? `${shortWt(m.worktree).padEnd(9)} | ` : "";
      lines.push(
        `  ${wt}${m.client.padEnd(6)} | ${m.provider.padEnd(8)} | ${m.model.padEnd(5)} | ${m.agent.padEnd(5)} | ${String(m.gateCount).padStart(5)} | ${String(m.fails).padStart(5)} | ${fmtRate(m.failRate).padStart(8)} | ${m.avgQuality.toFixed(1).padStart(10)} | ${fmtTokens(m.tokensInput).padStart(7)} in / ${fmtTokens(m.tokensOutput).padStart(7)} out`,
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
        "  project | mode     | model | gates | fails | failRate | avgQuality | tokens/session",
      );
      lines.push(
        "  ---------|----------|-------|-------|-------|----------|------------|----------------",
      );
    } else {
      lines.push(
        "  mode     | model | gates | fails | failRate | avgQuality | tokens/session",
      );
      lines.push(
        "  ----------|-------|-------|-------|----------|------------|----------------",
      );
    }
    for (const r of data.byPlanMode) {
      const mode = r.hasPlan ? "planned" : "no-plan";
      const wt = showWt ? `${shortWt(r.worktree).padEnd(9)} | ` : "";
      lines.push(
        `  ${wt}${mode.padEnd(9)} | ${r.model.padEnd(5)} | ${String(r.gates).padStart(5)} | ${String(r.fails).padStart(5)} | ${fmtRate(r.failRate).padStart(8)} | ${r.avgQuality.toFixed(1).padStart(10)} | ${fmtTokens(r.tokensInput).padStart(7)} in / ${fmtTokens(r.tokensOutput).padStart(7)} out`,
      );
    }
  }

  if (data.byRegime.length > 0) {
    const showWt = !data.scope;
    lines.push("\nby regime:");
    if (showWt) {
      lines.push(
        "  project | regime | model | gates | fails | failRate | avgQuality | tokens/session",
      );
      lines.push(
        "  ---------|--------|-------|-------|-------|----------|------------|----------------",
      );
    } else {
      lines.push(
        "  regime | model | gates | fails | failRate | avgQuality | tokens/session",
      );
      lines.push(
        "  --------|-------|-------|-------|----------|------------|----------------",
      );
    }
    for (const r of data.byRegime) {
      const wt = showWt ? `${shortWt(r.worktree).padEnd(9)} | ` : "";
      lines.push(
        `  ${wt}${r.regime.padEnd(7)} | ${r.model.padEnd(5)} | ${String(r.gates).padStart(5)} | ${String(r.fails).padStart(5)} | ${fmtRate(r.failRate).padStart(8)} | ${r.avgQuality.toFixed(1).padStart(10)} | ${fmtTokens(r.tokensInput).padStart(7)} in / ${fmtTokens(r.tokensOutput).padStart(7)} out`,
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
