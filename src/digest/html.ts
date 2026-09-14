// src/digest/html.ts — render digest as a single HTML page
//
// คอลัมน์เดียว max-width: 68rem · ไม่มี tab ไม่มีปุ่มพับ ไม่มี JS
// ใช้ DARK_THEME_CSS + TABLE_CSS จาก src/web/html.ts

import { DARK_THEME_CSS, esc, TABLE_CSS } from "../web/html.js";
import type {
  CostRow,
  DigestData,
  MemRow,
  PlanRow,
  RegimeModelRow,
  Tally,
} from "./collect.js";

function fmtDate(iso: string): string {
  return iso.slice(0, 10);
}

function fmtTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}K`;
  return String(Math.round(n));
}

function memRow(r: MemRow): string {
  const date = r.ts.slice(5, 10);
  return `<tr>
    <td class="muted">${esc(date)}</td>
    <td>${esc(r.agent)}</td>
    <td>${esc(r.text.replace(/\n/g, " ").slice(0, 120))}</td>
  </tr>`;
}

function planRow(p: PlanRow): string {
  const name = esc(p.file.replace(/\.md$/, ""));
  const status = esc(p.status ?? "active");
  const progress = p.total > 0 ? `${p.done}/${p.total}` : "\u2014";
  return `<tr>
    <td>${name}</td>
    <td class="muted">${status}</td>
    <td class="muted">${progress}</td>
  </tr>`;
}

function costRow(c: CostRow): string {
  const name = c.provider ? `${esc(c.provider)}/${esc(c.model)}` : esc(c.model);
  const costStr =
    c.imputed > 0
      ? `~$${c.imputed.toFixed(4)} imputed`
      : c.cost > 0
        ? `$${c.cost.toFixed(4)} recorded`
        : "unpriced";
  return `<tr>
    <td>${name}</td>
    <td class="muted">${c.sessions}</td>
    <td>${fmtTokens(c.input)}</td>
    <td>${fmtTokens(c.output)}</td>
    <td>${costStr}</td>
  </tr>`;
}

function tallyRow(t: Tally): string {
  return `<tr><td>${esc(t.key)}</td><td>${t.count}</td></tr>`;
}

function regimeModelRow(r: RegimeModelRow): string {
  return `<tr>
    <td class="muted">${esc(r.regime)}</td>
    <td>${esc(r.model)}</td>
    <td>${r.gates}</td>
    <td>${r.fails}</td>
  </tr>`;
}

function section(title: string, content: string, cls = ""): string {
  return `<h2 class="${cls}">${esc(title)}</h2>\n${content}`;
}

export function renderDigestHtml(d: DigestData): string {
  const units = d.verdicts.units_graded;
  const costBits: string[] = [];
  if (d.cost.imputed_usd > 0)
    costBits.push(`~$${d.cost.imputed_usd.toFixed(4)} (imputed)`);
  if (d.cost.total_usd > 0)
    costBits.push(`$${d.cost.total_usd.toFixed(4)} (recorded)`);
  const costLabel = costBits.length > 0 ? costBits.join(" · ") : "$0";

  // decisions table
  const decisionsHtml =
    d.decisions.length > 0
      ? `<table><thead><tr><th>Date</th><th>Agent</th><th>Decision</th></tr></thead><tbody>${d.decisions.map(memRow).join("")}</tbody></table>`
      : '<p class="muted">(none this period)</p>';

  // open bugs
  const bugsOpenHtml =
    d.bugs.open.length > 0
      ? `<table><thead><tr><th>Date</th><th>Agent</th><th>Bug</th></tr></thead><tbody>${d.bugs.open.map(memRow).join("")}</tbody></table>`
      : '<p class="muted">(none)</p>';
  const closedNote =
    d.bugs.closed.length > 0
      ? `<p class="muted">${d.bugs.closed.length} closed this period</p>`
      : "";

  // plans
  const inFlight = d.plans.pending.filter(
    (p) => p.status === "active" || !p.status,
  );
  const plansHtml =
    inFlight.length > 0
      ? `<table><thead><tr><th>Plan</th><th>Status</th><th>Progress</th></tr></thead><tbody>${inFlight.map(planRow).join("")}</tbody></table>`
      : '<p class="muted">(none)</p>';
  const shippedNote =
    d.plans.shipped.length > 0
      ? `<p class="muted">${d.plans.shipped.length} shipped this period</p>`
      : "";

  // cost
  const costHtml =
    d.cost.by_model.length > 0
      ? `<div style="overflow-x:auto"><table><thead><tr><th>Model</th><th>Sessions</th><th>In</th><th>Out</th><th>Cost</th></tr></thead><tbody>${d.cost.by_model.map(costRow).join("")}</tbody></table></div>` +
        (d.cost.unpriced_sessions > 0
          ? `<p class="muted">${d.cost.unpriced_sessions} sessions unpriced (no rate found — not counted as free)</p>`
          : "")
      : '<p class="muted">(no usage data)</p>';

  // verdicts — by_grade
  const gradeHtml =
    d.verdicts.by_grade.length > 0
      ? `<table><thead><tr><th>Grade</th><th>Count</th></tr></thead><tbody>${d.verdicts.by_grade.map(tallyRow).join("")}</tbody></table>`
      : "";

  // verdicts — by_reason_code
  const reasonHtml =
    d.verdicts.by_reason_code.length > 0
      ? `<table><thead><tr><th>Reason</th><th>Count</th></tr></thead><tbody>${d.verdicts.by_reason_code.map(tallyRow).join("")}</tbody></table>`
      : '<p class="muted">no graded fails in this period</p>';

  // verdicts — by_regime_model
  const regimeHtml =
    d.verdicts.by_regime_model.length > 0
      ? `<div style="overflow-x:auto"><table><thead><tr><th>Regime</th><th>Model</th><th>Gates</th><th>Fails</th></tr></thead><tbody>${d.verdicts.by_regime_model.map(regimeModelRow).join("")}</tbody></table></div>`
      : "";

  // sources
  const sourcesHtml = `<table><thead><tr><th>Source</th><th>Status</th><th>Detail</th></tr></thead><tbody>${d.sources
    .map(
      (s) =>
        `<tr><td>${esc(s.name)}</td><td class="${s.ok ? "pass" : "fail"}">${s.ok ? "ok" : "!!"}</td><td class="muted">${esc(s.detail)}</td></tr>`,
    )
    .join("")}</tbody></table>`;

  const malformedNote =
    d.skipped_malformed > 0
      ? `<p class="muted">${d.skipped_malformed} malformed log lines skipped</p>`
      : "";

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>fapony digest — ${fmtDate(d.since)} → ${fmtDate(d.generated_at)}</title>
<style>
  ${DARK_THEME_CSS}
  ${TABLE_CSS}
  body { max-width: 68rem; }
  .headline { font-size: 1.1rem; margin: 1rem 0 1.5rem; }
  .scope-note { color: var(--muted); font-size: 0.85rem; margin-bottom: 1.5rem; }
  table { margin-bottom: 1.5rem; }
  td:first-child { font-weight: 600; }
</style>
</head>
<body>

<h1>fapony digest — ${esc(fmtDate(d.since))} → ${esc(fmtDate(d.generated_at))}</h1>
<div class="scope-note">${esc(d.worktree)}<br>${esc(d.scope_note)}</div>

<div class="headline">
  <strong>${units}</strong> unit${units === 1 ? "" : "s"} graded · <strong>${d.verdicts.round1_pct}%</strong> passed round 1 · <strong>${esc(costLabel)}</strong>
</div>

${section("Decisions", decisionsHtml)}

${section(
  `Notes (${d.notes.length})`,
  d.notes.length > 0
    ? `<table><thead><tr><th>Date</th><th>Agent</th><th>Note</th></tr></thead><tbody>${d.notes.map(memRow).join("")}</tbody></table>`
    : '<p class="muted">(none this period)</p>',
)}

${section(`Open Bugs (${d.bugs.open.length})`, bugsOpenHtml + closedNote)}

${section(`In Flight (${inFlight.length})`, plansHtml + shippedNote)}

${section("Cost", costHtml)}

${section("How Work Failed", reasonHtml)}
${gradeHtml ? `\n${section("By Grade", gradeHtml)}` : ""}
${regimeHtml ? `\n${section("By Regime × Model", regimeHtml)}` : ""}

${section("Sources", sourcesHtml)}

${malformedNote}

</body>
</html>`;
}
