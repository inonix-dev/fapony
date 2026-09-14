// src/mcp/tools/usage.ts — fapony_usage tool

import {
  type ImputeSummary,
  imputeResult,
  loadPrices,
  type PriceTable,
} from "../../price/index.js";
import {
  mergeBytesByTool,
  type PassiveUsageResult,
  readClaudeCodeUsage,
  readCodexUsage,
  readPassiveUsage,
  readZcodeUsage,
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
    `~$${imp.total_imputed.toFixed(4)} est. over ${imp.priced_sessions} priced sessions`,
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

  const data: PassiveUsageResult = readPassiveUsage(
    worktree,
    since,
    until,
    detail,
  );

  // ZCode data is always fetched when the DB exists
  const zcodeData = readZcodeUsage(worktree, since, until, detail);

  // Claude Code data is always fetched when the projects dir exists
  const claudeCodeData = readClaudeCodeUsage(worktree, since, until, detail);

  // Codex data is always fetched when the sessions dir exists
  const codexData = readCodexUsage(worktree, since, until, detail);

  // ราคา list จาก cache อย่างเดียว — อ่านครั้งเดียวต่อ call ไม่ใช่ต่อ section
  const prices = loadPrices();

  if (args.json === true) {
    return jsonResult({
      ...data,
      imputation: imputationOf(data, prices),
      zcode:
        zcodeData.session_count > 0
          ? { ...zcodeData, imputation: imputationOf(zcodeData, prices) }
          : null,
      claude_code:
        claudeCodeData.session_count > 0
          ? {
              ...claudeCodeData,
              imputation: imputationOf(claudeCodeData, prices),
            }
          : null,
      codex:
        codexData.session_count > 0
          ? { ...codexData, imputation: imputationOf(codexData, prices) }
          : null,
    });
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
    // Merged across all clients: only the Claude Code reader populates the
    // field today, so reading the top-level (opencode) detail alone would
    // always come back empty.
    const bytes = mergeBytesByTool(
      data.detail,
      zcodeData.detail,
      claudeCodeData.detail,
      codexData.detail,
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

  // ZCode usage section
  if (zcodeData.session_count > 0) {
    const zImp = imputationOf(zcodeData, prices);
    lines.push("");
    lines.push("zcode usage:");
    lines.push(
      `  total: ${zcodeData.total_tokens_input} in / ${zcodeData.total_tokens_output} out / ${zcodeData.total_tokens_reasoning} reasoning tokens over ${zcodeData.session_count} sessions`,
    );
    lines.push(
      `  cache: ${zcodeData.total_tokens_cache_read.toLocaleString()} read / ${zcodeData.total_tokens_cache_write.toLocaleString()} write`,
    );
    if (zcodeData.by_model.length > 0) {
      lines.push("  by model:");
      for (const m of zcodeData.by_model) {
        const prefix = m.provider ? `${m.provider}/` : "";
        lines.push(
          `    ${prefix}${m.model}: ${m.tokens_input} in / ${m.tokens_output} out (cache r/w: ${(m.tokens_cache_read ?? 0).toLocaleString()} / ${(m.tokens_cache_write ?? 0).toLocaleString()})${imputedSuffix(m.provider, m.model, zImp)}`,
        );
      }
    }
    lines.push(...imputedTextLines("", zcodeData, prices));
  }

  // Claude Code usage section
  if (claudeCodeData.session_count > 0) {
    const ccImp = imputationOf(claudeCodeData, prices);
    lines.push("");
    lines.push("claude code usage:");
    lines.push(
      `  total: ${claudeCodeData.total_tokens_input.toLocaleString()} in / ${claudeCodeData.total_tokens_output.toLocaleString()} out / ${claudeCodeData.total_tokens_reasoning.toLocaleString()} reasoning tokens over ${claudeCodeData.session_count} sessions`,
    );
    lines.push(
      `  cache: ${claudeCodeData.total_tokens_cache_read.toLocaleString()} read / ${claudeCodeData.total_tokens_cache_write.toLocaleString()} write`,
    );
    if (claudeCodeData.by_model.length > 0) {
      lines.push("  by model:");
      for (const m of claudeCodeData.by_model) {
        const prefix = m.provider ? `${m.provider}/` : "";
        lines.push(
          `    ${prefix}${m.model}: ${m.tokens_input.toLocaleString()} in / ${m.tokens_output.toLocaleString()} out (cache r/w: ${(m.tokens_cache_read ?? 0).toLocaleString()} / ${(m.tokens_cache_write ?? 0).toLocaleString()})${imputedSuffix(m.provider, m.model, ccImp)}`,
        );
      }
    }
    lines.push(...imputedTextLines("", claudeCodeData, prices));
  }

  // Codex usage section
  if (codexData.session_count > 0) {
    const cxImp = imputationOf(codexData, prices);
    lines.push("");
    lines.push("codex usage:");
    lines.push(
      `  total: ${codexData.total_tokens_input.toLocaleString()} in / ${codexData.total_tokens_output.toLocaleString()} out / ${codexData.total_tokens_reasoning.toLocaleString()} reasoning tokens over ${codexData.session_count} sessions`,
    );
    lines.push(
      `  cache: ${codexData.total_tokens_cache_read.toLocaleString()} read / ${codexData.total_tokens_cache_write.toLocaleString()} write`,
    );
    if (codexData.by_model.length > 0) {
      lines.push("  by model:");
      for (const m of codexData.by_model) {
        const prefix = m.provider ? `${m.provider}/` : "";
        lines.push(
          `    ${prefix}${m.model}: ${m.tokens_input.toLocaleString()} in / ${m.tokens_output.toLocaleString()} out (cache r/w: ${(m.tokens_cache_read ?? 0).toLocaleString()} / ${(m.tokens_cache_write ?? 0).toLocaleString()})${imputedSuffix(m.provider, m.model, cxImp)}`,
        );
      }
    }
    lines.push(...imputedTextLines("", codexData, prices));
  }

  return { content: [{ type: "text", text: lines.join("\n") }] };
}
