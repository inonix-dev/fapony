// src/core/types.ts — shared pure types + constants (no runtime deps)

export interface ModelRates {
  input: number;
  output: number;
  cacheRead: number;
  /** null = the table does not provide it → use the input rate instead (see calcCost) */
  cacheWrite: number | null;
}

export interface PriceTable {
  fetched_at: string;
  models: Record<string, ModelRates>;
}

export interface ModelBreakdown {
  provider: string;
  model: string;
  session_count: number;
  tokens_input: number;
  tokens_output: number;
  tokens_reasoning: number;
  tokens_cache_read: number;
  tokens_cache_write: number;
  cost: number;
}

export interface SessionDetail {
  session_id: string;
  model: string;
  steps: number;
  tools: Record<string, number>;
}

export interface ToolLatencyStat {
  count: number;
  avgMs: number;
}

export interface StepTimingSummary {
  /** step-finish row count (mirrors UsageDetail.steps for SQLite providers). */
  steps: number;
  /** Mean per-part duration from embedded data.time (row-timestamp fallback when absent). */
  avgStepMs: number | null;
  /** How many durations were actually measured (vs. steps with no time signal). */
  stepSamples: number;
  /** Mean per-step tokens — averages only, never summed (sums overlap). */
  avgStepInput: number | null;
  avgStepOutput: number | null;
  avgStepCost: number | null;
  /** Mean tool latency grouped by tool name (from data.state.time). */
  toolLatencyMsByType: Record<string, ToolLatencyStat>;
  note: string;
}

export interface StaleReadFile {
  file: string;
  /** How many distinct sessions read this file (diversity, not just count). */
  sessions: number;
  /** Total Read calls across those sessions. */
  reads: number;
}

export interface UsageDetail {
  /** Global tool-call counts across the filtered sessions (activity signal, not quality). */
  tool_breakdown: Record<string, number>;
  /** Context bytes per tool — size of tool_result content blocks. */
  bytes_by_tool?: Record<string, number>;
  /** Total step-finish parts across the filtered sessions. */
  steps: number;
  /** Per-session breakdown (SQL-aggregated, never raw part rows). */
  by_session: SessionDetail[];
  stale_reads?: StaleReadFile[];
  note: string;
  /** Per-step timing/token/latency signal — present only when detail:true was requested. */
  timing?: StepTimingSummary | null;
}

export interface PassiveUsageResult {
  total_tokens_input: number;
  total_tokens_output: number;
  total_tokens_reasoning: number;
  total_tokens_cache_read: number;
  total_tokens_cache_write: number;
  total_cost: number;
  session_count: number;
  by_model: ModelBreakdown[];
  detail?: UsageDetail | null;
  zcode?: PassiveUsageResult | null;
  claude_code?: PassiveUsageResult | null;
  error?: string;
}

export const EMPTY_RESULT: PassiveUsageResult = {
  total_tokens_input: 0,
  total_tokens_output: 0,
  total_tokens_reasoning: 0,
  total_tokens_cache_read: 0,
  total_tokens_cache_write: 0,
  total_cost: 0,
  session_count: 0,
  by_model: [],
};

/** Common shape every client reader implements — see registry.ts. */
export type PassiveUsageReader = (
  worktree?: string,
  since?: number,
  until?: number,
  detail?: boolean,
  full?: boolean,
) => PassiveUsageResult;

export const STEP_TOKENS_NOTE =
  "step tokens overlap (per-step context window) — SUM(step tokens) != session tokens; steps is a count only";

export const TIMING_NOTE =
  "timing from embedded part fields only (data.time/data.state.time/step-finish tokens) with row-timestamp fallback; averages, never raw I/O";

// --- Tool result types (PLAN-lib-layer chunk 2d) ---

export interface ToolResult {
  content: { type: "text"; text: string }[];
  isError?: boolean;
}

export function jsonResult(data: unknown): ToolResult {
  return {
    content: [{ type: "text", text: JSON.stringify(data) }],
  };
}

export function errorResult(message: string): ToolResult {
  return {
    content: [{ type: "text", text: JSON.stringify({ error: message }) }],
    isError: true,
  };
}

export function parseToolResult(result: ToolResult): unknown {
  return JSON.parse(result.content[0].text);
}
