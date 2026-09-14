// test/price.test.ts — unit tests for src/price/ (fetch + resolve)
//
// ห้ามยิง network ระหว่างเทสต์: parse/merge/resolve/calc ใช้ fixture ล้วน
// prices.json จริงถูก pin ไปที่ temp dir ผ่าน FAPONY_STATE_DIR

import assert from "node:assert";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  fetchPriceTable,
  loadPrices,
  mergePriceTables,
  type PriceTable,
  parsePricesResponse,
  writePrices,
} from "../src/price/fetch.js";
import { calcCost, imputeResult, resolvePrice } from "../src/price/resolve.js";
import type { PassiveUsageResult } from "../src/session/types.js";

// ตาราง fixture เล็ก ๆ — เรตจริงจาก OpenRouter 2026-09-14 (ย่อ)
function fixtureTable(): PriceTable {
  return {
    fetched_at: "2026-09-14T00:00:00.000Z",
    models: {
      "anthropic/claude-sonnet-5": {
        input: 0.000002,
        output: 0.00001,
        cacheRead: 0.0000002,
        cacheWrite: 0.0000025,
      },
      "xiaomi/mimo-v2.5": {
        input: 0.000000435,
        output: 0.00000087,
        cacheRead: 0.0000000036,
        cacheWrite: null,
      },
      "z-ai/glm-5.3-flash": {
        input: 0.000000075,
        output: 0.00000025,
        cacheRead: 0.000000015,
        cacheWrite: null,
      },
      "inclusionai/ling-3.0-flash-fin:free": {
        input: 0,
        output: 0,
        cacheRead: 0,
        cacheWrite: null,
      },
    },
  };
}

function usageWith(models: PassiveUsageResult["by_model"]): PassiveUsageResult {
  return {
    total_tokens_input: 0,
    total_tokens_output: 0,
    total_tokens_reasoning: 0,
    total_tokens_cache_read: 0,
    total_tokens_cache_write: 0,
    total_cost: 0,
    session_count: models.reduce((s, m) => s + m.session_count, 0),
    by_model: models,
  };
}

function breakdown(
  provider: string,
  model: string,
  sessions = 1,
): PassiveUsageResult["by_model"][number] {
  return {
    provider,
    model,
    session_count: sessions,
    tokens_input: 1000,
    tokens_output: 100,
    tokens_reasoning: 10,
    tokens_cache_read: 9000,
    tokens_cache_write: 500,
    cost: 0,
  };
}

// ─── parsePricesResponse ────────────────────────────────────────────

export function testParsePricesStripsTildeAndKeepsFreeIds(): void {
  const parsed = parsePricesResponse({
    data: [
      {
        id: "~openai/gpt-astra-latest",
        pricing: { prompt: "0.00001", completion: "0.00005" },
      },
      {
        id: "inclusionai/ling-3.0-flash-vl:free",
        pricing: { prompt: "0", completion: "0" },
      },
      { id: "no-pricing", pricing: null },
      { id: "bad-numbers", pricing: { prompt: "abc", completion: "1" } },
    ],
  });
  assert.ok(parsed["openai/gpt-astra-latest"]);
  assert.equal(parsed["openai/gpt-astra-latest"].input, 0.00001);
  // input_cache_write ไม่มี → null (caller fallback เรต input)
  assert.equal(parsed["openai/gpt-astra-latest"].cacheWrite, null);
  assert.equal(parsed["inclusionai/ling-3.0-flash-vl:free"].input, 0);
  assert.ok(!("no-pricing" in parsed));
  assert.ok(!("bad-numbers" in parsed));
  console.log("  ✓ parsePricesResponse strips ~, keeps :free, skips bad rows");
}

// ─── resolve: 5 รูปจากแผน §7 ───────────────────────────────────────

export function testResolveDirectAndOpenrouterPrefix(): void {
  const t = fixtureTable();
  // ตรงตัว (claude code)
  assert.equal(
    resolvePrice("anthropic", "claude-sonnet-5", t).status,
    "priced",
  );
  // ตัด openrouter/ แล้วชน (openrouter/xiaomi/mimo-v2.5)
  assert.equal(
    resolvePrice("openrouter", "xiaomi/mimo-v2.5", t).status,
    "priced",
  );
  console.log("  ✓ resolve direct + openrouter/ prefix");
}

export function testResolveVendorPrefixAndFreeSuffix(): void {
  const t = fixtureTable();
  // opencode-go/mimo-v2.5 → ตัด prefix เหลือ slug → suffix match xiaomi/mimo-v2.5
  const r = resolvePrice("opencode-go", "mimo-v2.5", t);
  assert.equal(r.status, "priced");
  assert.equal(r.rates?.input, 0.000000435);
  // opencode/ling-3.0-flash-fin-free → ตัด prefix + -free → แถว 0 ทั้งแถว = free
  assert.equal(
    resolvePrice("opencode", "ling-3.0-flash-fin-free", t).status,
    "free",
  );
  // openrouter/tencent/hy3:free → free endpoint ราคาจริง 0 (ไม่ตีด้วยเรต base)
  assert.equal(
    resolvePrice("openrouter", "tencent/hy3:free", t).status,
    "free",
  );
  // opencode/deepseek-v4-flash-free — ตัด -free แล้ว slug ไม่มีในตาราง แต่ยังเป็น free
  assert.equal(
    resolvePrice("opencode", "deepseek-v4-flash-free", t).status,
    "free",
  );
  console.log("  ✓ resolve vendor prefix + -free suffix");
}

export function testResolveBareSlugAndLocal(): void {
  const t = fixtureTable();
  // zcode ไม่มี vendor: GLM-5.3-Flash → z-ai/glm-5.3-flash (case-insensitive)
  assert.equal(resolvePrice("", "GLM-5.3-Flash", t).status, "priced");
  // local = free จริง ไม่ใช่ unpriced
  assert.equal(resolvePrice("lmstudio_local", "qwen3.5-9b", t).status, "free");
  console.log("  ✓ resolve bare slug + local free");
}

export function testResolveUnpricedIsNotZero(): void {
  const t = fixtureTable();
  // opencode/big-pickle (147 sessions ไม่มี token) + mimo/(no model id)
  for (const [p, m] of [
    ["opencode", "big-pickle"],
    ["mimo", "(no model id)"],
  ] as const) {
    const r = resolvePrice(p, m, t);
    assert.equal(r.status, "unpriced", `${p}/${m}`);
    assert.equal(r.rates, null, `${p}/${m}`);
  }
  console.log("  ✓ resolve unpriced returns null rates, never zero-rate");
}

// ─── calcCost: done criteria #5 ─────────────────────────────────────

export function testCalcCostUsesCacheReadRate(): void {
  // cache-read ถูกกว่า input สด ~10× (claude-sonnet-5 จริง): ถ้า impl เอา
  // cacheRead ไปคูณเรต input เทสต์นี้ต้องแดง — ไม่งั้นตัวเลขบวม ~10×
  const rates = fixtureTable().models["anthropic/claude-sonnet-5"];
  const tokens = {
    input: 1000,
    cacheRead: 9_000_000,
    cacheWrite: 0,
    output: 100,
  };
  const got = calcCost(tokens, rates);
  const want = 1000 * 0.000002 + 9_000_000 * 0.0000002 + 0 + 100 * 0.00001;
  assert.equal(got, want);
  // สanity: คิดผิดเรต (cache ที่เรต input) ต้องแพงกว่าหลายเท่า — เทสต์นี้พัง
  // ทันทีถ้าใครรวมเรต แปลว่า guard ยังทำงาน
  const wrong = 1000 * 0.000002 + 9_000_000 * 0.000002 + 100 * 0.00001;
  assert.ok(wrong / got > 5, `guard ratio ${wrong / got} should exceed 5x`);
  console.log(
    "  ✓ calcCost prices cache-read at its own rate (mutation guard)",
  );
}

export function testCalcCostCacheWriteFallsBackToInput(): void {
  // xiaomi ไม่มี input_cache_write → ใช้เรต input
  const rates = fixtureTable().models["xiaomi/mimo-v2.5"];
  const got = calcCost(
    { input: 0, cacheRead: 0, cacheWrite: 1000, output: 0 },
    rates,
  );
  assert.equal(got, 1000 * 0.000000435);
  console.log("  ✓ calcCost cache-write falls back to input rate");
}

// ─── merge: ไม่ลบของเก่า ───────────────────────────────────────────

export function testMergeKeepsOldIds(): void {
  const old = fixtureTable();
  const merged = mergePriceTables(old, {
    "anthropic/claude-sonnet-5": {
      input: 1,
      output: 1,
      cacheRead: 1,
      cacheWrite: 1,
    },
  });
  // ตัวที่ fetch รอบนี้มี → ทับด้วยของใหม่
  assert.equal(merged.models["anthropic/claude-sonnet-5"].input, 1);
  // ตัวที่หลุดตารางรอบนี้ → ของเก่ายังอยู่
  assert.ok(merged.models["xiaomi/mimo-v2.5"]);
  console.log("  ✓ mergePriceTables never deletes old ids");
}

// ─── load/write: หาย/พัง → null ────────────────────────────────────

export function testLoadPricesMissingIsNull(): void {
  const dir = mkdtempSync(join(tmpdir(), "fapony-price-"));
  const prev = process.env.FAPONY_STATE_DIR;
  process.env.FAPONY_STATE_DIR = join(dir, "no-such-subdir");
  try {
    assert.equal(loadPrices(), null);
  } finally {
    if (prev === undefined) delete process.env.FAPONY_STATE_DIR;
    else process.env.FAPONY_STATE_DIR = prev;
    rmSync(dir, { recursive: true, force: true });
  }
  console.log("  ✓ loadPrices missing file → null (caller shows — + hint)");
}

export function testWriteLoadRoundtrip(): void {
  const dir = mkdtempSync(join(tmpdir(), "fapony-price-"));
  const prev = process.env.FAPONY_STATE_DIR;
  process.env.FAPONY_STATE_DIR = dir;
  try {
    writePrices(fixtureTable());
    const back = loadPrices();
    assert.ok(back);
    assert.equal(back.models["xiaomi/mimo-v2.5"].input, 0.000000435);
  } finally {
    if (prev === undefined) delete process.env.FAPONY_STATE_DIR;
    else process.env.FAPONY_STATE_DIR = prev;
    rmSync(dir, { recursive: true, force: true });
  }
  console.log("  ✓ writePrices/loadPrices roundtrip under FAPONY_STATE_DIR");
}

// ─── fetch: stub fetcher (ไม่ยิงเน็ต) ───────────────────────────────

export async function testFetchPriceTableStub(): Promise<void> {
  const stub = async (_url: string | URL | Request): Promise<Response> =>
    new Response(
      JSON.stringify({
        data: [
          {
            id: "a/b",
            pricing: { prompt: "1", completion: "2", input_cache_read: "0.1" },
          },
        ],
      }),
    );
  const out = await fetchPriceTable(stub as typeof fetch);
  assert.equal(out["a/b"].input, 1);
  assert.equal(out["a/b"].cacheRead, 0.1);
  console.log("  ✓ fetchPriceTable works with stub fetcher (no network)");
}

// ─── imputeResult: bucket แยก ───────────────────────────────────────

export function testImputeBuckets(): void {
  const t = fixtureTable();
  const summary = imputeResult(
    usageWith([
      breakdown("anthropic", "claude-sonnet-5", 2),
      breakdown("lmstudio_local", "qwen3.5-9b", 1),
      breakdown("opencode", "big-pickle", 3),
    ]),
    t,
  );
  assert.equal(summary.priced_sessions, 2);
  assert.equal(summary.free_sessions, 1);
  assert.equal(summary.unpriced_sessions, 3);
  assert.ok(summary.total_imputed > 0);
  const big = summary.by_model.find((m) => m.model === "big-pickle");
  assert.equal(big?.status, "unpriced");
  assert.equal(big?.imputed_cost, 0);
  console.log("  ✓ imputeResult splits priced/free/unpriced buckets");
}
