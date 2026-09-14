// src/price/resolve.ts — normalize model id + คิด list-price equivalent
//
// กฎเหล็ก: map ไม่ได้ต้องเป็น unpriced ห้ามตีเป็น 0 เงียบ ๆ (failure mode หลัก
// ของฟีเจอร์นี้) · free มีแต่ของที่ราคา 0 จริง (local / แถว :free ในตาราง)

import type { ModelBreakdown, PassiveUsageResult } from "../session/types.js";
import type { ModelRates, PriceTable } from "./fetch.js";

export type PriceStatus = "priced" | "free" | "unpriced";

export interface PriceResolution {
  status: PriceStatus;
  rates: ModelRates | null;
}

/** prefix ของ client ที่แปะหน้าทุก model id — ตัดทิ้งแล้ว lookup ใหม่ */
const CLIENT_PREFIXES = ["openrouter/", "opencode-go/", "opencode/"];

/** tier ต่อท้ายของ OpenRouter — :free คือ endpoint ฟรีจริง :batch คือส่วนลด */
function stripTier(id: string): string {
  return id.endsWith(":free") || id.endsWith(":batch")
    ? id.slice(0, id.lastIndexOf(":"))
    : id;
}

/**
 * รายชื่อ candidate id ตามลำดับความเฉพาะ: ตรงตัวก่อน กว้างทีหลัง
 * (ตรงตัวชนก่อนเสมอ — bare slug แมตช์กว้างสุดอยู่ท้าย)
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
  // opencode ต่อ -free ท้าย slug ของรุ่นฟรี (deepseek-v4-flash-free)
  if (rest.endsWith("-free")) out.push(rest.slice(0, -"-free".length));
  return out;
}

/**
 * หาเรตให้ model หนึ่งตัว — คืน null เฉพาะของ local เท่านั้นที่ข้ามตาราง
 * (local ไม่เคยมีราคาตั้งแต่แรก ไม่ใช่ "หาไม่เจอ")
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
  // ลงท้าย :free หรือ -free = เรียกผ่าน free endpoint / รุ่นฟรีของ client มา
  // ราคาจริงคือ 0 (ไม่ใช่ list price) ไม่ว่าจะ map OpenRouter ได้หรือไม่
  if (model.endsWith(":free") || model.endsWith("-free"))
    return { status: "free", rates: null };
  for (const id of candidateIds(provider, model)) {
    const rates = table.models[id] ?? table.models[stripTier(id)];
    if (rates) {
      // แถวราคา 0 ทั้งแถว (:free / รุ่นฟรี) = free จริง ไม่ใช่ unpriced
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
  // zcode เก็บแค่ slug ไม่มี vendor (GLM-5.3-Flash) — เทียบส่วนหลัง / ตรงตัว
  // แบบ case-insensitive (exact ไม่ใช่ fuzzy: ยาวเท่ากันทั้งสตริง)
  // ฝั่งตารางตัด tier (:free/:batch) ก่อนเทียบ — slug เปลือยจะได้ชนแถว :free
  // ที่ราคา 0 จริง (เช่น ling-3.0-flash-fin) กลายเป็น free ไม่ใช่ unpriced
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
 * คิดเงิน pure: แยกเรต input / cache-read / cache-write — ห้ามใช้เรตเดียวรวบ
 *
 * reasoning ไม่คูณแยก: ของ Anthropic-family thinking รวมอยู่ใน output อยู่แล้ว
 * (reader แยกเก็บไว้ดูเฉย ๆ) คูณแยก = double count · cache_write ไม่มีในตาราง
 * → fallback เรต input (เขียน cache แพงกว่า/เท่าอ่านสด ไม่มีทางถูกกว่า)
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
  /** ดอลลาร์ list-price — 0 เมื่อ free/unpriced (ดู status อย่าอ่านเลขอย่างเดียว) */
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
 * ตีราคาทั้ง PassiveUsageResult — ใช้กับผลสด (stats/usage) หรือแถว cache
 * (usage-web) ก็ได้เพราะรับแค่ token ต่อ model
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
