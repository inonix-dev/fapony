// src/mcp/tools/usage.ts — fapony_usage tool

import {
  type ImputeSummary,
  imputeResult,
  loadPrices,
  type PriceTable,
} from "../../price/index.js";
import {
  CLIENTS,
  mergeBytesByTool,
  type PassiveUsageResult,
} from "../../session/index.js";
import { jsonResult, type ToolResult } from "../types.js";

/** สรุป list-price ต่อ client — additive ไม่แตะบรรทัดเดิม */
function imputationOf(
  result: PassiveUsageResult,
  prices: PriceTable | null,
): (ImputeSummary & { prices_fetched_at: string }) | null {
  if (result.session_count === 0 || !prices) return null;
  return {
    ...imputeResult(result, prices),
    prices_fetched_at: prices.fetched_at,
  };
}

function imputedTextLines(
  label: string,
  result: PassiveUsageResult,
  prices: PriceTable | null,
): string[] {
  if (result.session_count === 0) return [];
  const imp = imputationOf(result, prices);
  if (!imp)
    return [`  ${label}list-price equivalent: — (run \`fapony price-scan\`)`];
  const parts = [
    `~$${imp.total_imputed.toFixed(4)} over ${imp.priced_sessions} priced sessions`,
  ];
  if (imp.free_sessions > 0) parts.push(`${imp.free_sessions} free`);
  if (imp.unpriced_sessions > 0)
    parts.push(
      `unpriced: ${imp.unpriced_sessions} sessions / ${imp.unpriced_tokens.toLocaleString()} tokens`,
    );
  return [`  ${label}list-price equivalent: ${parts.join(" · ")}`];
}

/** ราคา list ราย model ต่อท้ายชื่อรุ่น — เฉพาะแถวที่ client ไม่บันทึก cost */
function imputedSuffix(
  provider: string,
  model: string,
  imp: (ImputeSummary & { prices_fetched_at: string }) | null,
): string {
  if (!imp) return "";
  const m = imp.by_model.find(
    (b) => b.provider === provider && b.model === model,
  );
  if (m && m.status === "priced")
    return ` (~$${m.imputed_cost.toFixed(4)} list-price)`;
  return "";
}

export function toolPassiveUsage(args: Record<string, unknown>): ToolResult {
  const worktree =
    typeof args.worktree === "string" ? args.worktree : undefined;
  const since = typeof args.since === "number" ? args.since : undefined;
  const until = typeof args.until === "number" ? args.until : undefined;
  const detail = args.detail === true;

  const primary = CLIENTS.find((c) => c.primary)!;
  const others = CLIENTS.filter((c) => !c.primary);

  const data: PassiveUsageResult = primary.read(worktree, since, until, detail);

  // Every non-primary client is always fetched when its own log exists.
  const otherResults = others.map((client) => ({
    client,
    result: client.read(worktree, since, until, detail),
  }));

  // ราคา list จาก cache อย่างเดียว — อ่านครั้งเดียวต่อ call ไม่ใช่ต่อ section
  const prices = loadPrices();

  if (args.json === true) {
    const json: Record<string, unknown> = {
      ...data,
      imputation: imputationOf(data, prices),
    };
    for (const { client, result } of otherResults) {
      json[client.key] =
        result.session_count > 0
          ? { ...result, imputation: imputationOf(result, prices) }
          : null;
    }
    return jsonResult(json);
  }

  const lines: string[] = [];
  lines.push("Passive Usage Report");
  lines.push("====================");
  lines.push(`Sessions: ${data.session_count}`);
  lines.push(`Total Input Tokens: ${data.total_tokens_input.toLocaleString()}`);
  lines.push(
    `Total Output Tokens: ${data.total_tokens_output.toLocaleString()}`,
  );
  lines.push(
    `Total Reasoning Tokens: ${data.total_tokens_reasoning.toLocaleString()}`,
  );
  lines.push(`Cache Read: ${data.total_tokens_cache_read.toLocaleString()}`);
  lines.push(`Cache Write: ${data.total_tokens_cache_write.toLocaleString()}`);
  lines.push(`Total Cost: $${data.total_cost.toFixed(4)}`);
  lines.push(...imputedTextLines("", data, prices));

  if (data.by_model.length > 0) {
    lines.push("");
    lines.push("By Model:");
    lines.push("--------");
    for (const m of data.by_model) {
      const prefix = m.provider ? `${m.provider}/` : "";
      lines.push(
        `  ${prefix}${m.model}: ${m.session_count} sessions, ` +
          `${m.tokens_input.toLocaleString()} in / ${m.tokens_output.toLocaleString()} out, ` +
          `$${m.cost.toFixed(4)}`,
      );
    }
  }

  // detail:true is opt-in — default text above is byte-identical to before.
  if (detail && data.detail) {
    lines.push("");
    lines.push("Detail (tool activity — signal, not quality):");
    lines.push(`  steps: ${data.detail.steps.toLocaleString()}`);
    const tools = Object.entries(data.detail.tool_breakdown).sort(
      (a, b) => b[1] - a[1],
    );
    if (tools.length > 0) {
      lines.push("  by tool:");
      for (const [tool, count] of tools.slice(0, 20)) {
        lines.push(`    ${tool}: ${count.toLocaleString()}`);
      }
      if (tools.length > 20) {
        lines.push(`    ... +${tools.length - 20} more (see json:true)`);
      }
    }
    // Context bytes by tool — proportion of context window consumed per tool.
    // Bytes are a proxy for tokens; shown as % of total, never as "tokens".
    // Merged across all clients: OpenCode/ZCode (state.output), Claude Code
    // and Codex (tool_result) each populate bytes_by_tool, so reading the
    // top-level (opencode) detail alone would miss the other clients.
    const bytes = mergeBytesByTool(
      data.detail,
      ...otherResults.map((r) => r.result.detail),
    );
    if (bytes) {
      const entries = Object.entries(bytes).sort((a, b) => b[1] - a[1]);
      const total = entries.reduce((s, e) => s + e[1], 0);
      if (entries.length > 0 && total > 0) {
        lines.push("  context bytes by tool (% of total):");
        for (const [tool, b] of entries.slice(0, 10)) {
          const pct = ((b / total) * 100).toFixed(1);
          lines.push(`    ${tool}: ${pct}%`);
        }
        if (entries.length > 10) {
          lines.push(`    ... +${entries.length - 10} more (see json:true)`);
        }
      }
    }
    lines.push(`  sessions with activity: ${data.detail.by_session.length}`);
    const top = data.detail.by_session.slice(0, 10);
    for (const s of top) {
      const topTool = Object.entries(s.tools).sort((a, b) => b[1] - a[1])[0];
      lines.push(
        `    ${s.session_id}: ${s.steps} steps` +
          (topTool ? `, top tool ${topTool[0]}×${topTool[1]}` : ""),
      );
    }
    if (data.detail.by_session.length > 10) {
      lines.push(
        `    ... +${data.detail.by_session.length - 10} more (see json:true)`,
      );
    }
  }

  // One text section per non-primary client — same shape for every client,
  // new ones need no new formatting code, only a registry.ts entry.
  for (const { client, result } of otherResults) {
    if (result.session_count === 0) continue;
    const imp = imputationOf(result, prices);
    const label = client.reportLabel ?? client.key;
    lines.push("");
    lines.push(`${label} usage:`);
    lines.push(
      `  total: ${result.total_tokens_input.toLocaleString()} in / ${result.total_tokens_output.toLocaleString()} out / ${result.total_tokens_reasoning.toLocaleString()} reasoning tokens over ${result.session_count} sessions`,
    );
    lines.push(
      `  cache: ${result.total_tokens_cache_read.toLocaleString()} read / ${result.total_tokens_cache_write.toLocaleString()} write`,
    );
    if (result.by_model.length > 0) {
      lines.push("  by model:");
      for (const m of result.by_model) {
        const prefix = m.provider ? `${m.provider}/` : "";
        lines.push(
          `    ${prefix}${m.model}: ${m.tokens_input.toLocaleString()} in / ${m.tokens_output.toLocaleString()} out (cache r/w: ${(m.tokens_cache_read ?? 0).toLocaleString()} / ${(m.tokens_cache_write ?? 0).toLocaleString()})${imputedSuffix(m.provider, m.model, imp)}`,
        );
      }
    }
    lines.push(...imputedTextLines("", result, prices));
  }

  return { content: [{ type: "text", text: lines.join("\n") }] };
}
