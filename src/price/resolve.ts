// src/price/resolve.ts — normalize model id + compute list-price equivalent
//
// Hard rule: an unmappable model must be unpriced, never silently counted as 0 (the main failure mode
// of this feature) · free only applies to things that truly cost 0 (local / :free rows in the table)

import type { ModelBreakdown, PassiveUsageResult } from "../session/types.js";
import type { ModelRates, PriceTable } from "./fetch.js";

export type PriceStatus = "priced" | "free" | "unpriced";

export interface PriceResolution {
  status: PriceStatus;
  rates: ModelRates | null;
}

/** client prefix prepended to every model id — strip it, then look up again */
const CLIENT_PREFIXES = ["openrouter/", "opencode-go/", "opencode/"];

/** OpenRouter's trailing tier — :free is a genuinely free endpoint, :batch is a discount */
function stripTier(id: string): string {
  return id.endsWith(":free") || id.endsWith(":batch")
    ? id.slice(0, id.lastIndexOf(":"))
    : id;
}

/**
 * Candidate ids ordered by specificity: exact first, broad later
 * (an exact match always wins — the bare slug is the broadest match and goes last)
 */
export function candidateIds(provider: string, model: string): string[] {
  const full = provider ? `${provider}/${model}` : model;
  const out: string[] = [full];
  let rest = full;
  for (const p of CLIENT_PREFIXES) {
    if (rest.startsWith(p)) {
      rest = rest.slice(p.length);
      out.push(rest);
      break;
    }
  }
  // opencode appends -free to the slug of a free model (deepseek-v4-flash-free)
  if (rest.endsWith("-free")) out.push(rest.slice(0, -"-free".length));
  return out;
}

/**
 * Find rates for one model — null only for local, which skips the table
 * (local never had a price to begin with, it is not "not found")
 */
function isLocalProvider(provider: string): boolean {
  return provider === "lmstudio_local";
}

export function resolvePrice(
  provider: string,
  model: string,
  table: PriceTable,
): PriceResolution {
  if (!model || model === "(no model id)" || model === "(unknown)")
    return { status: "unpriced", rates: null };
  if (isLocalProvider(provider)) return { status: "free", rates: null };
  // ends with :free or -free = used a free endpoint / the client's free model
  // the real price is 0 (not list price), whether or not OpenRouter maps it
  if (model.endsWith(":free") || model.endsWith("-free"))
    return { status: "free", rates: null };
  for (const id of candidateIds(provider, model)) {
    const rates = table.models[id] ?? table.models[stripTier(id)];
    if (rates) {
      // an all-zero rate row (:free / free model) = genuinely free, not unpriced
      if (
        rates.input === 0 &&
        rates.output === 0 &&
        rates.cacheRead === 0 &&
        (rates.cacheWrite ?? 0) === 0
      )
        return { status: "free", rates };
      return { status: "priced", rates };
    }
  }
  // zcode stores only the slug with no vendor (GLM-5.3-Flash) — compare the suffix / exact
  // case-insensitive match (exact, not fuzzy: the whole string must be equal in length)
  // the table side strips the tier (:free/:batch) before comparing — so a bare slug hits the :free
  // row that is truly 0 (e.g. ling-3.0-flash-fin) and becomes free, not unpriced
  const slug = stripTier(
    candidateIds(provider, model).at(-1) ?? "",
  ).toLowerCase();
  if (slug) {
    const ids = Object.keys(table.models).sort();
    for (const id of ids) {
      const rawSuffix = id.includes("/")
        ? id.slice(id.lastIndexOf("/") + 1)
        : id;
      if (stripTier(rawSuffix).toLowerCase() === slug) {
        const rates = table.models[id];
        if (
          rates.input === 0 &&
          rates.output === 0 &&
          rates.cacheRead === 0 &&
          (rates.cacheWrite ?? 0) === 0
        )
          return { status: "free", rates };
        return { status: "priced", rates };
      }
    }
  }
  return { status: "unpriced", rates: null };
}

export interface TokenCounts {
  input: number;
  cacheRead: number;
  cacheWrite: number;
  output: number;
}

/**
 * Pure costing: separate rates for input / cache-read / cache-write — never one rate for all
 *
 * reasoning is not multiplied separately: Anthropic-family thinking is already included in output
 * (the reader keeps it separately just for visibility); multiplying separately = double counting · cache_write absent from the table
 * → fall back to the input rate (writing cache costs more than or equal to a fresh read, never less)
 */
export function calcCost(t: TokenCounts, rates: ModelRates): number {
  return (
    t.input * rates.input +
    t.cacheRead * rates.cacheRead +
    t.cacheWrite * (rates.cacheWrite ?? rates.input) +
    t.output * rates.output
  );
}

export interface ImputedModel {
  provider: string;
  model: string;
  session_count: number;
  tokens_input: number;
  tokens_output: number;
  tokens_cache_read: number;
  tokens_cache_write: number;
  status: PriceStatus;
  /** dollars at list-price — 0 when free/unpriced (check status, do not read the number alone) */
  imputed_cost: number;
}

export interface ImputeSummary {
  total_imputed: number;
  priced_sessions: number;
  free_sessions: number;
  unpriced_sessions: number;
  unpriced_tokens: number;
  by_model: ImputedModel[];
}

/**
 * Price an entire PassiveUsageResult — works on live results (stats/usage) or cache rows
 * (usage-web) alike, because it only takes tokens per model
 */
export function imputeResult(
  result: PassiveUsageResult,
  table: PriceTable,
): ImputeSummary {
  const by_model: ImputedModel[] = [];
  let total_imputed = 0;
  let priced_sessions = 0;
  let free_sessions = 0;
  let unpriced_sessions = 0;
  let unpriced_tokens = 0;
  for (const m of result.by_model as ModelBreakdown[]) {
    const r = resolvePrice(m.provider, m.model, table);
    let cost = 0;
    if (r.status === "priced" && r.rates) {
      cost = calcCost(
        {
          input: m.tokens_input,
          cacheRead: m.tokens_cache_read,
          cacheWrite: m.tokens_cache_write,
          output: m.tokens_output,
        },
        r.rates,
      );
      total_imputed += cost;
      priced_sessions += m.session_count;
    } else if (r.status === "free") {
      free_sessions += m.session_count;
    } else {
      unpriced_sessions += m.session_count;
      unpriced_tokens +=
        m.tokens_input +
        m.tokens_output +
        m.tokens_cache_read +
        m.tokens_cache_write;
    }
    by_model.push({
      provider: m.provider,
      model: m.model,
      session_count: m.session_count,
      tokens_input: m.tokens_input,
      tokens_output: m.tokens_output,
      tokens_cache_read: m.tokens_cache_read,
      tokens_cache_write: m.tokens_cache_write,
      status: r.status,
      imputed_cost: cost,
    });
  }
  return {
    total_imputed,
    priced_sessions,
    free_sessions,
    unpriced_sessions,
    unpriced_tokens,
    by_model,
  };
}
