// src/price/fetch.ts — fetch OpenRouter's price table + cache it as prices.json
//
// prices are cache, not state: stored at ~/.config/fapony/prices.json (honors
// FAPONY_STATE_DIR) no new SQLite tables (DB Schema rule: 2 tables only)
// refresh happens only when someone runs `fapony price-scan` — a query never fetches on its own
// (same discipline as usage-scan) offline, read the existing cache

import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import type { ModelRates, PriceTable } from "../core/types.js";
import { faponyDir } from "../db/load.js";
import type { Config } from "../db/types.js";

export type { ModelRates, PriceTable } from "../core/types.js";

const PRICES_FILENAME = "prices.json";
const MODELS_URL = "https://openrouter.ai/api/v1/models";

export function pricesPath(config?: Config): string {
  return join(faponyDir(config), PRICES_FILENAME);
}

/** Read the cache — null when the file is missing or broken (caller shows "—" + hint) */
export function loadPrices(config?: Config): PriceTable | null {
  const p = pricesPath(config);
  if (!existsSync(p)) return null;
  try {
    const raw = JSON.parse(readFileSync(p, "utf-8")) as Partial<PriceTable>;
    if (!raw || typeof raw.models !== "object" || !raw.models) return null;
    return {
      fetched_at: typeof raw.fetched_at === "string" ? raw.fetched_at : "",
      models: raw.models,
    };
  } catch {
    return null;
  }
}

/** Write atomically (tmp + rename), create the state dir when absent */
export function writePrices(table: PriceTable, config?: Config): void {
  const p = pricesPath(config);
  mkdirSync(dirname(p), { recursive: true });
  const tmp = `${p}.tmp`;
  writeFileSync(tmp, JSON.stringify(table, null, 2), "utf-8");
  renameSync(tmp, p);
}

function toRate(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/**
 * Turn OpenRouter's raw response into a rate table (pure — testable without hitting the network)
 *
 * Real fields (confirmed 2026-09-14, 445 models): pricing.prompt / .completion /
 * .input_cache_read / .input_cache_write (optional) / .input_cache_write_1h
 * (the 1h TTL rate of some models — the standard 5m rate suffices because logs do not report TTL)
 * ignore pricing.web_search / pricing.overrides (tiers based on min_prompt_tokens /
 * utc_days — use the base rate and state the limitation) · ids starting with ~ (alias) are dropped
 * ids ending :free / :batch are kept as-is (they are their own price rows)
 */
export function parsePricesResponse(json: unknown): Record<string, ModelRates> {
  const out: Record<string, ModelRates> = {};
  const data = (json as { data?: unknown })?.data;
  if (!Array.isArray(data)) return out;
  for (const m of data) {
    const rec = m as { id?: unknown; pricing?: unknown };
    if (typeof rec.id !== "string" || !rec.id) continue;
    const pricing = rec.pricing as Record<string, unknown> | undefined;
    if (!pricing || typeof pricing !== "object") continue;
    const input = toRate(pricing.prompt);
    const output = toRate(pricing.completion);
    if (input === null || output === null) continue;
    const cacheRead = toRate(pricing.input_cache_read) ?? 0;
    const cacheWrite = toRate(pricing.input_cache_write);
    const id = rec.id.startsWith("~") ? rec.id.slice(1) : rec.id;
    out[id] = { input, output, cacheRead, cacheWrite };
  }
  return out;
}

/**
 * Merge the new table into the old cache — merge, not replace: an id missing from
 * this response (an old model dropped from the table) must still be priced with its old rate
 */
export function mergePriceTables(
  old: PriceTable | null,
  fresh: Record<string, ModelRates>,
): PriceTable {
  return {
    fetched_at: new Date().toISOString(),
    models: { ...(old?.models ?? {}), ...fresh },
  };
}

/** Fetch the table from OpenRouter (public, no auth) — fetcher is injectable for tests */
export async function fetchPriceTable(
  fetcher: typeof fetch = fetch,
): Promise<Record<string, ModelRates>> {
  const res = await fetcher(MODELS_URL);
  if (!res.ok) throw new Error(`OpenRouter ${res.status}`);
  return parsePricesResponse(await res.json());
}

export async function cmdPriceScan(rawArgs: string[]): Promise<void> {
  if (rawArgs.length > 0) {
    console.error("usage: fapony price-scan");
    process.exit(1);
  }
  let fresh: Record<string, ModelRates>;
  try {
    fresh = await fetchPriceTable();
  } catch (err) {
    console.error(
      `fapony price-scan: fetch failed (${String(err)}) — the existing cache is still here, use the prices you have`,
    );
    process.exit(1);
  }
  const merged = mergePriceTables(loadPrices(), fresh);
  writePrices(merged);
  console.log(
    `prices: ${Object.keys(fresh).length} models fetched, ${Object.keys(merged.models).length} cached → ${pricesPath()}`,
  );
}
