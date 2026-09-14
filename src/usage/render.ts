// src/usage/render.ts — static HTML generator for usage-web
//
// Pure server-rendered HTML — no client-side JS, no polling.

import { imputeResult, loadPrices, type PriceTable } from "../price/index.js";
import type { ModelBreakdown, PassiveUsageResult } from "../session/types.js";
import { esc, fmtCost, fmtTokens, shortModel } from "./format.js";

const FIELDS: (keyof ModelBreakdown)[] = [
  "tokens_input",
  "tokens_output",
  "tokens_cache_read",
  "tokens_cache_write",
  "tokens_reasoning",
  "session_count",
  "cost",
];

const HEADERS = [
  "Provider",
  "In",
  "Out",
  "Cache R",
  "Cache W",
  "Reason",
  "Sess",
  "Cost",
];

interface SummaryMetrics {
  sessions: number;
  cacheHitRate: number;
  reasoningPct: number;
  outputRatio: number;
  avgPerSession: number;
  totalCost: number;
  input: number;
  output: number;
  reasoning: number;
  cacheRead: number;
}

function calcMetrics(d: PassiveUsageResult | null): SummaryMetrics {
  if (!d || d.session_count === 0)
    return {
      sessions: 0,
      cacheHitRate: 0,
      reasoningPct: 0,
      outputRatio: 0,
      avgPerSession: 0,
      totalCost: 0,
      input: 0,
      output: 0,
      reasoning: 0,
      cacheRead: 0,
    };
  const totalCache = d.total_tokens_cache_read + d.total_tokens_cache_write;
  const contextTokens = d.total_tokens_input + d.total_tokens_output;
  return {
    sessions: d.session_count,
    cacheHitRate: totalCache > 0 ? d.total_tokens_cache_read / totalCache : 0,
    reasoningPct:
      contextTokens > 0 ? d.total_tokens_reasoning / contextTokens : 0,
    outputRatio:
      d.total_tokens_input + d.total_tokens_output > 0
        ? d.total_tokens_output / (d.total_tokens_input + d.total_tokens_output)
        : 0,
    avgPerSession:
      d.session_count > 0
        ? Math.round(
            (d.total_tokens_input +
              d.total_tokens_output +
              d.total_tokens_reasoning) /
              d.session_count,
          )
        : 0,
    totalCost: d.total_cost,
    input: d.total_tokens_input,
    output: d.total_tokens_output,
    reasoning: d.total_tokens_reasoning,
    cacheRead: d.total_tokens_cache_read,
  };
}

function pct(n: number): string {
  return `${(n * 100).toFixed(1)}%`;
}

/** Shorten a worktree path to its basename for display. */
function shortWt(wt: string): string {
  const parts = wt.replace(/\/$/, "").split("/");
  return parts[parts.length - 1] || wt;
}

function barHtml(value: number, max: number, color: string): string {
  const w = max > 0 ? Math.min(100, Math.round((value / max) * 100)) : 0;
  return `<div class="bar"><div class="bar-fill" style="width:${w}%;background:${color}"></div></div>`;
}

function metric(
  label: string,
  value: string,
  cls: string,
  bar: string,
  wide = false,
): string {
  return `<div class="card-metric${wide ? " wide" : ""}">
    <div class="metric-label">${label}</div>
    <div class="metric-value ${cls}">${value}</div>
    ${bar}
  </div>`;
}

// caller filters m.sessions === 0 out before calling — a card with no
// sessions has nothing to show, so it's hidden rather than rendered empty
function summaryCard(name: string, color: string, m: SummaryMetrics): string {
  const maxInput = Math.max(m.input, m.output, m.reasoning, 1);
  return `<div class="card" style="border-left-color:${color}">
  <div class="card-title" style="color:${color}">${name} <span class="sample">(${m.sessions} sessions)</span></div>
  <div class="card-metrics">
    ${metric("Cache Hit", pct(m.cacheHitRate), m.cacheHitRate > 0.7 ? "pass" : "warn", barHtml(m.cacheHitRate, 1, m.cacheHitRate > 0.7 ? "var(--green)" : "var(--yellow)"))}
    ${metric("Reasoning", pct(m.reasoningPct), m.reasoningPct > 0.15 ? "warn" : "pass", barHtml(m.reasoningPct, 1, m.reasoningPct > 0.15 ? "var(--red)" : "var(--green)"))}
    ${metric("Output", pct(m.outputRatio), "", barHtml(m.outputRatio, 1, m.outputRatio > 0.3 ? "var(--green)" : "var(--yellow)"))}
    ${metric("Input", fmtTokens(m.input), "", barHtml(m.input, maxInput, "var(--accent)"))}
    ${metric("Output", fmtTokens(m.output), "", barHtml(m.output, maxInput, "var(--green)"))}
    ${metric("Reasoning", fmtTokens(m.reasoning), m.reasoningPct > 0.15 ? "warn" : "", barHtml(m.reasoning, maxInput, "var(--yellow)"))}
    ${metric("Cache Read", fmtTokens(m.cacheRead), "", "")}
    ${metric("Avg/Session", fmtTokens(m.avgPerSession), "", "")}
    ${metric("Cost", fmtCost(m.totalCost), "", "", true)}
  </div>
</div>`;
}

function cell(
  d: ModelBreakdown | undefined,
  field: keyof ModelBreakdown,
): string {
  if (!d) return '<td class="muted">\u2014</td>';
  const v = d[field];
  if (typeof v !== "number") return '<td class="muted">\u2014</td>';
  if (field === "cost") return `<td>${fmtCost(v)}</td>`;
  return `<td>${fmtTokens(v)}</td>`;
}

function modelRows(data: PassiveUsageResult | null): string {
  if (!data || data.by_model.length === 0)
    return '    <tr><td class="muted" colspan="9">no sessions</td></tr>';
  return data.by_model
    .sort(
      (a, b) =>
        b.tokens_input +
        b.tokens_output +
        b.tokens_reasoning +
        b.tokens_cache_read +
        b.tokens_cache_write -
        (a.tokens_input +
          a.tokens_output +
          a.tokens_reasoning +
          a.tokens_cache_read +
          a.tokens_cache_write),
    )
    .map(
      (m) =>
        `    <tr data-model="${esc(m.model)}">
      <td class="model-name">${esc(shortModel(m.model))}</td>
      <td class="muted">${esc(m.provider || "\u2014")}</td>
      ${FIELDS.map((f) => cell(m, f)).join("")}
    </tr>`,
    )
    .join("\n");
}

function totalsRow(data: PassiveUsageResult | null): string {
  if (!data || data.session_count === 0)
    return '    <tr class="totals"><td>Totals</td><td class="muted" colspan="8">no data</td></tr>';
  return `    <tr class="totals">
      <td>Totals</td>
      <td></td>
      <td>${fmtTokens(data.total_tokens_input)}</td>
      <td>${fmtTokens(data.total_tokens_output)}</td>
      <td>${fmtTokens(data.total_tokens_cache_read)}</td>
      <td>${fmtTokens(data.total_tokens_cache_write)}</td>
      <td>${fmtTokens(data.total_tokens_reasoning)}</td>
      <td>${data.session_count}</td>
      <td>${fmtCost(data.total_cost)}</td>
    </tr>`;
}

/**
 * Badge for a client whose log could not be read. Without it the row is zeros,
 * which reads as "never used" — the wrong conclusion, and an invisible one.
 */
function errorBadge(data: PassiveUsageResult | null): string {
  if (!data?.error) return "";
  return ` <span class="read-error" title="fapony could not read this client's session log \u2014 usually schema drift after a client update">could not read: ${esc(data.error)}</span>`;
}

function clientTable(
  id: string,
  name: string,
  color: string,
  data: PassiveUsageResult | null,
  note = "",
): string {
  return `
<h2 style="color:${color}">${name} <span class="sample">(${data?.session_count ?? 0} sessions)</span>${errorBadge(data)}</h2>
<table id="${id}">
  <thead>
    <tr>
      <th>Model</th>
      ${HEADERS.map((h) => `<th>${h}</th>`).join("")}
    </tr>
  </thead>
  <tbody>
${modelRows(data)}
  </tbody>
  <tfoot>
${totalsRow(data)}
  </tfoot>
</table>${note ? `\n<div class="meta">${note}</div>` : ""}`;
}

function freshnessBar(scannedAt: string): string {
  const ageMs = Date.now() - new Date(scannedAt).getTime();
  const ageDays = ageMs / 86400000;
  let dotClass: string;
  let ageLabel: string;

  if (ageDays < 1) {
    dotClass = "fresh";
    const ageH = ageMs / 3600000;
    ageLabel =
      ageH < 1
        ? `${Math.round(ageMs / 60000)}m ago`
        : `${ageH.toFixed(1)}h ago`;
  } else if (ageDays < 7) {
    dotClass = "stale";
    ageLabel = `${ageDays.toFixed(1)}d ago`;
  } else {
    dotClass = "stale warn";
    ageLabel = `${Math.round(ageDays)}d ago`;
  }

  return `<div class="meta">
  <span class="status ${dotClass}"></span>
  <span>data as of <strong>${new Date(scannedAt).toLocaleString()}</strong> (${ageLabel})</span>
  <span>\u00b7</span>
  <span><code>fapony usage-scan</code> to update</span>
</div>`;
}

type ClientData = {
  opencode: PassiveUsageResult;
  zcode: PassiveUsageResult;
  claude_code: PassiveUsageResult;
  codex: PassiveUsageResult;
};

/** Context-share bar: proportion of input+output tokens per client. */
function shareSection(
  oc: SummaryMetrics,
  zc: SummaryMetrics,
  cc: SummaryMetrics,
  cx: SummaryMetrics,
): string {
  const ctxTokens = [
    { name: "OpenCode", color: "var(--green)", tokens: oc.input + oc.output },
    { name: "ZCode", color: "var(--accent)", tokens: zc.input + zc.output },
    {
      name: "Claude Code",
      color: "var(--yellow)",
      tokens: cc.input + cc.output,
    },
    { name: "Codex", color: "var(--accent)", tokens: cx.input + cx.output },
  ];
  const ctxTotal = ctxTokens.reduce((s, c) => s + c.tokens, 0);

  return `<div class="share-section">
  <div class="share-title">context share (tokens)</div>
  <div class="share-bar">
    ${
      ctxTotal > 0
        ? ctxTokens
            .map((c) => {
              const w = Math.round((c.tokens / ctxTotal) * 100);
              return w > 0
                ? `<div class="share-seg" style="width:${w}%;background:${c.color}" title="${c.name}: ${fmtTokens(c.tokens)}"></div>`
                : "";
            })
            .join("")
        : '<div class="share-seg" style="width:100%;background:var(--border)"></div>'
    }
  </div>
  <div class="share-legend">
    ${ctxTokens
      .map((c) => {
        const pctStr =
          ctxTotal > 0 ? ((c.tokens / ctxTotal) * 100).toFixed(1) : "0.0";
        return `<span class="share-item"><span class="share-dot" style="background:${c.color}"></span>${c.name} ${pctStr}%</span>`;
      })
      .join("")}
  </div>
</div>`;
}

/**
 * เติมราคาตั้งให้แถวที่ client ไม่บันทึก cost (0) — ของที่มีราคาจริงอยู่แล้ว
 * ไม่แตะ · คืน view ไว้ render + note ไว้ใต้ตาราง (ป้าย list-price ทุกจุด)
 */
function withImputed(
  data: PassiveUsageResult | null,
  prices: PriceTable | null,
): { view: PassiveUsageResult | null; note: string } {
  if (!data || data.session_count === 0) return { view: data, note: "" };
  if (!prices)
    return {
      view: data,
      note: "list-price equivalent unavailable \u2014 run <code>fapony price-scan</code>",
    };
  const s = imputeResult(data, prices);
  const realByKey = new Map(
    data.by_model.map((m) => [`${m.provider}\0${m.model}`, m]),
  );
  const byModel = s.by_model.map((m) => {
    const real = realByKey.get(`${m.provider}\0${m.model}`);
    return {
      provider: m.provider,
      model: m.model,
      session_count: m.session_count,
      tokens_input: m.tokens_input,
      tokens_output: m.tokens_output,
      tokens_reasoning: real?.tokens_reasoning ?? 0,
      tokens_cache_read: m.tokens_cache_read,
      tokens_cache_write: m.tokens_cache_write,
      // รวมกับ cost จริงรายรุ่น (opencode บันทึกเอง) — ข้างไหนมีค่ากว่ากันเอาข้างนั้น
      cost: real && real.cost > 0 ? real.cost : m.imputed_cost,
    };
  });
  const realTotal = data.total_cost > 0 ? data.total_cost : s.total_imputed;
  const parts = [
    `~$${s.total_imputed.toFixed(4)} over ${s.priced_sessions} priced sessions`,
  ];
  if (s.free_sessions > 0) parts.push(`${s.free_sessions} free`);
  if (s.unpriced_sessions > 0)
    parts.push(
      `unpriced: ${s.unpriced_sessions} sessions (${fmtTokens(s.unpriced_tokens)} tokens)`,
    );
  return {
    view: { ...data, total_cost: realTotal, by_model: byModel },
    note: `list-price equivalent: ${parts.join(" \u00b7 ")} \u00b7 prices ${esc(prices.fetched_at.slice(0, 10))} \u2014 run <code>fapony price-scan</code> to refresh`,
  };
}

export function renderUsageHtml(
  projectData: Map<string, ClientData>,
  scannedAt: string,
  ownerName?: string,
  prices?: PriceTable | null,
): string {
  // Find the global entry (worktree=null) and per-project entries.
  const globalData = projectData.get("__global__");
  const projectKeys = [...projectData.keys()]
    .filter((k) => k !== "__global__")
    .sort();

  // ราคา list จาก cache อย่างเดียว — serve ไม่ fetch เอง (offline ได้)
  const table = prices === undefined ? loadPrices() : prices;

  const owner = ownerName?.trim() ? esc(ownerName.trim()) : "";

  function projectSection(
    label: string,
    data: ClientData,
    isGlobal: boolean,
  ): string {
    const oc = withImputed(data.opencode, table);
    const zc = withImputed(data.zcode, table);
    const cc = withImputed(data.claude_code, table);
    const cx = withImputed(data.codex, table);
    const pOc = calcMetrics(oc.view);
    const pZc = calcMetrics(zc.view);
    const pCc = calcMetrics(cc.view);
    const pCx = calcMetrics(cx.view);
    const totalSessions =
      pOc.sessions + pZc.sessions + pCc.sessions + pCx.sessions;
    // A project with no sessions is noise — unless the reason it has none is
    // that every client failed to read, which is exactly what must be shown.
    const anyError = [
      data.opencode,
      data.zcode,
      data.claude_code,
      data.codex,
    ].some((d) => d?.error);
    if (totalSessions === 0 && !isGlobal && !anyError) return "";

    const heading = isGlobal ? "All projects" : shortWt(label);

    // การ์ดที่ไม่มี session เลยไม่มีอะไรให้ดู — ซ่อนแทนที่จะโชว์ "no sessions"
    const cards = [
      ["OpenCode", "var(--green)", pOc],
      ["ZCode", "var(--accent)", pZc],
      ["Claude Code", "var(--yellow)", pCc],
      ["Codex", "var(--accent)", pCx],
    ] as const;

    return `
<h2 style="color:var(--accent)">${esc(heading)} <span class="sample">(${totalSessions} sessions)</span></h2>
<div class="cards">
${cards
  .filter(([, , m]) => m.sessions > 0)
  .map(([name, color, m]) => summaryCard(name, color, m))
  .join("\n")}
</div>

${shareSection(pOc, pZc, pCc, pCx)}

${clientTable(`t-oc-${label}`, "OpenCode", "var(--green)", oc.view, oc.note)}
${clientTable(`t-zc-${label}`, "ZCode", "var(--accent)", zc.view, zc.note)}
${clientTable(`t-cc-${label}`, "Claude Code", "var(--yellow)", cc.view, cc.note)}
${clientTable(`t-cx-${label}`, "Codex", "var(--accent)", cx.view, cx.note)}`;
  }

  // Project navigation (when there are multiple projects).
  const navHtml =
    projectKeys.length > 1
      ? `<div class="meta" style="margin-bottom:0.5rem">
  ${projectKeys.map((k) => `<a href="#proj-${esc(k)}" style="color:var(--accent);text-decoration:none">${esc(shortWt(k))}</a>`).join(" · ")}
  ${globalData ? ` · <a href="#proj-all" style="color:var(--accent);text-decoration:none;font-weight:600">all</a>` : ""}
</div>`
      : "";

  // Render all project sections.
  const sections: string[] = [];

  // Global section first (if exists).
  if (globalData) {
    sections.push(
      `<div id="proj-all">${projectSection("all", globalData, true)}</div>`,
    );
  }

  // Per-project sections.
  for (const k of projectKeys) {
    const data = projectData.get(k)!;
    sections.push(
      `<div id="proj-${esc(k)}">${projectSection(k, data, false)}</div>`,
    );
  }

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>fapony usage${owner ? ` \u2014 ${owner}` : ""}</title>
<style>
  :root { --bg: #0d1117; --fg: #c9d1d9; --border: #30363d; --accent: #58a6ff; --green: #3fb950; --red: #f85149; --yellow: #d29922; --muted: #8b949e; }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif; background: var(--bg); color: var(--fg); line-height: 1.6; padding: 2rem; max-width: 960px; margin: 0 auto; }
  .header { display: flex; justify-content: space-between; align-items: baseline; gap: 1rem; }
  .owner { color: var(--muted); font-size: 0.9rem; font-weight: 400; white-space: nowrap; }
  h1 { font-size: 1.5rem; margin-bottom: 0.5rem; }
  h2 { font-size: 1.1rem; margin: 1.5rem 0 0.5rem; border-bottom: 1px solid var(--border); padding-bottom: 0.3rem; }
  .meta { color: var(--muted); font-size: 0.85rem; margin-bottom: 1.5rem; display: flex; gap: 1rem; align-items: center; flex-wrap: wrap; }
  .status { display: inline-block; width: 8px; height: 8px; border-radius: 50%; }
  .status.fresh { background: var(--green); }
  .status.stale { background: var(--yellow); }
  .status.stale.warn { background: var(--red); }
  .sample { font-size: 0.8rem; color: var(--muted); font-weight: 400; }
  table { width: 100%; border-collapse: collapse; margin-bottom: 0.5rem; font-size: 0.85rem; }
  th, td { padding: 0.4rem 0.6rem; text-align: right; border-bottom: 1px solid var(--border); white-space: nowrap; }
  th { color: var(--muted); font-weight: 600; font-size: 0.75rem; text-transform: uppercase; position: sticky; top: 0; background: var(--bg); }
  td:first-child, th:first-child { text-align: left; }
  td.model-name { font-weight: 600; color: var(--fg); }
  tr:hover { background: #161b22; }
  .muted { color: var(--muted); }
  .totals { font-weight: 700; background: #161b22; }
  .totals td { border-top: 2px solid var(--border); }
  .pass { color: var(--green); }
  .warn { color: var(--yellow); }
  .cards { display: flex; flex-direction: column; gap: 0.8rem; margin-bottom: 1.5rem; }
  .card { background: #161b22; border: 1px solid var(--border); border-left: 3px solid var(--accent); border-radius: 6px; padding: 0.8rem 1rem; }
  .card-title { font-weight: 600; font-size: 0.95rem; margin-bottom: 0.5rem; }
  .card-metrics { display: grid; grid-template-columns: repeat(auto-fit, minmax(120px, 1fr)); gap: 1rem; }
  .card-metric { font-size: 0.8rem; }
  .card-metric.wide { grid-column: span 2; }
  .metric-label { color: var(--muted); font-size: 0.65rem; text-transform: uppercase; letter-spacing: 0.03em; }
  .metric-value { font-size: 0.95rem; font-weight: 700; color: var(--fg); }
  .bar { height: 3px; background: var(--border); border-radius: 2px; margin-top: 0.15rem; overflow: hidden; }
  .bar-fill { height: 100%; border-radius: 2px; transition: width 0.3s; }
  .share-section { margin-bottom: 1.5rem; }
  .read-error { font-size: 0.7rem; font-weight: 600; color: var(--red); border: 1px solid var(--red); border-radius: 4px; padding: 0.1rem 0.4rem; vertical-align: middle; }
  .share-title { font-size: 0.85rem; color: var(--muted); margin-bottom: 0.4rem; }
  .share-bar { display: flex; height: 20px; border-radius: 4px; overflow: hidden; background: var(--border); }
  .share-seg { height: 100%; transition: width 0.3s; min-width: 1px; }
  .share-legend { display: flex; gap: 1rem; margin-top: 0.3rem; flex-wrap: wrap; }
  .share-item { font-size: 0.75rem; color: var(--fg); display: flex; align-items: center; gap: 0.3rem; }
  .share-dot { width: 8px; height: 8px; border-radius: 2px; flex-shrink: 0; }
  .footer { margin-top: 1.5rem; font-size: 0.8rem; color: var(--muted); text-align: center; }
</style>
</head>
<body>

<div class="header">
  <h1>fapony usage</h1>
  ${owner ? `<span class="owner">${owner}</span>` : ""}
</div>
${freshnessBar(scannedAt)}

${navHtml}

${sections.join("\n")}

 <div class="footer">
  Tokens and cost come from each client's own session log — ZCode, Claude Code and Codex record no cost, so theirs reads $0.
  Costs marked list-price equivalent are OpenRouter list rates over tokens already logged (not money paid) — unpriced models are listed, never folded into $0.
  <br>
  Run <code>fapony usage-scan</code> to refresh data.
 </div>

</body>
</html>`;
}
