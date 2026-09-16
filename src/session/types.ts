// src/session/types.ts — shared types + constants for session usage providers

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
  /**
   * Files read across 2+ sessions in this window and never edited/written —
   * candidates for pasting into CLAUDE.md instead of re-reading every
   * session. Top 20 by session count. Needs a wide `since` window (many
   * sessions) before the pattern means anything — noise below that.
   */
  stale_reads?: StaleReadFile[];
  /**
   * Step-token sums are NOT reported: per-step tokens overlap (each step
   * carries the full context window), so SUM(step tokens) >> session tokens.
   * Verified on real data — see testSessionDetailStepTokensNotSummed.
   */
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
  /** Present only when detail:true was requested (additive, default absent). */
  detail?: UsageDetail | null;
  /** ZCode sessions, when available. Absent when ZCode DB not found. */
  zcode?: PassiveUsageResult | null;
  /** Claude Code sessions, when available. Absent when projects dir not found. */
  claude_code?: PassiveUsageResult | null;
  /**
   * Why this read came back short, when it did. Absent on success.
   *
   * Zeros with no `error` mean "no sessions matched"; zeros WITH an error mean
   * "could not read the client's log" — most often schema drift after the
   * client updated. The two used to be indistinguishable: a renamed column
   * made the query throw, the catch-all swallowed it, and the numbers just
   * quietly went missing.
   */
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
