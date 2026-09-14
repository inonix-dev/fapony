// src/price/fetch.ts — ดึงตารางราคา OpenRouter + cache เป็น prices.json
//
// ราคาเป็น cache ไม่ใช่ state: เก็บที่ ~/.config/fapony/prices.json (เคารพ
// FAPONY_STATE_DIR) ห้ามเพิ่มตาราง SQLite (กฎ DB Schema: 2 ตารางเท่านั้น)
// refresh เกิดตอนคนสั่ง `fapony price-scan` เท่านั้น — query ไม่ fetch เอง
// (วินัยเดียวกับ usage-scan) offline แล้วอ่าน cache เดิม

import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { faponyDir } from "../db/load.js";
import type { Config } from "../db/types.js";

const PRICES_FILENAME = "prices.json";
const MODELS_URL = "https://openrouter.ai/api/v1/models";

/** เรตราย token (ดอลลาร์) — ทุกเรตมาจาก OpenRouter ตรง ๆ ไม่เดา */
export interface ModelRates {
  input: number;
  output: number;
  cacheRead: number;
  /** null = ตารางไม่ให้มา → ใช้เรต input แทน (ดู calcCost) */
  cacheWrite: number | null;
}

export interface PriceTable {
  fetched_at: string;
  models: Record<string, ModelRates>;
}

export function pricesPath(config?: Config): string {
  return join(faponyDir(config), PRICES_FILENAME);
}

/** อ่าน cache — คืน null เมื่อไม่มีไฟล์หรือพัง (caller แสดง — + hint) */
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

/** เขียนแบบ atomic (tmp + rename) สร้าง state dir เมื่อยังไม่มี */
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
 * แปลง response ดิบของ OpenRouter เป็นตารางเรต (pure — เทสต์ได้โดยไม่ยิงเน็ต)
 *
 * ฟิลด์จริง (ยืนยัน 2026-09-14, 445 models): pricing.prompt / .completion /
 * .input_cache_read / .input_cache_write (optional) / .input_cache_write_1h
 * (เรต 1h TTL ของบางรุ่น — ใช้เรต 5m มาตรฐานพอ เพราะ log ไม่บอก TTL)
 * เมิน pricing.web_search / pricing.overrides (tier ตาม min_prompt_tokens /
 * utc_days — ใช้ base rate แล้วประกาศข้อจำกัด) · id ขึ้นต้น ~ (alias) ตัดทิ้ง
 * id ลงท้าย :free / :batch เก็บตามนั้น (เป็นแถวราคาของมันเอง)
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
 * รวมตารางใหม่เข้ากับ cache เดิม — merge ไม่ replace: id ที่หายไปจาก
 * response รอบนี้ (รุ่นเก่าหลุดตาราง) ต้องยังคิดราคาได้ด้วยเรตเดิม
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

/** ดึงตารางจาก OpenRouter (public, ไม่ต้อง auth) — fetcher แทรกได้ไว้เทสต์ */
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
      `fapony price-scan: fetch failed (${String(err)}) — cache เดิมยังอยู่ ใช้ราคาที่มีได้`,
    );
    process.exit(1);
  }
  const merged = mergePriceTables(loadPrices(), fresh);
  writePrices(merged);
  console.log(
    `prices: ${Object.keys(fresh).length} models fetched, ${Object.keys(merged.models).length} cached → ${pricesPath()}`,
  );
}
