// test/usage.test.ts — unit tests for src/usage/format.ts + render.ts + cache.ts

import assert from "node:assert";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { PriceTable } from "../src/price/fetch.js";
import type { PassiveUsageResult } from "../src/session/types.js";
import { EMPTY_RESULT } from "../src/session/types.js";
import {
  type CacheEntry,
  cacheMeta,
  mergeEntries,
  readCache,
  writeCache,
} from "../src/usage/cache.js";
import {
  fmtCost,
  fmtDelta,
  fmtTokens,
  shortModel,
} from "../src/usage/format.js";
import { renderUsageHtml } from "../src/usage/render.js";

const NOW = new Date().toISOString();

// Helper: wrap old per-client args into the new project-grouped Map signature.
// render อ่าน prices.json เองเมื่อไม่ส่ง arg ที่ 4 — pin FAPONY_STATE_DIR ไปที่
// temp ว่างทุกครั้งกันเลขจริงบนเครื่องหลุดเข้าเทสต์ (non-determinism)
function renderGlobal(
  oc: PassiveUsageResult,
  zc: PassiveUsageResult | null = null,
  cc: PassiveUsageResult | null = null,
  cx: PassiveUsageResult | null = null,
  scannedAt: string = NOW,
  prices?: PriceTable | null,
): string {
  const dir = mkdtempSync(join(tmpdir(), "fapony-render-"));
  const prev = process.env.FAPONY_STATE_DIR;
  process.env.FAPONY_STATE_DIR = dir;
  try {
    const data = new Map([
      ["__global__", { opencode: oc, zcode: zc, claude_code: cc, codex: cx }],
    ]);
    return renderUsageHtml(data, scannedAt, undefined, prices);
  } finally {
    if (prev === undefined) delete process.env.FAPONY_STATE_DIR;
    else process.env.FAPONY_STATE_DIR = prev;
    rmSync(dir, { recursive: true, force: true });
  }
}

const fixturePrices: PriceTable = {
  fetched_at: "2026-09-14T00:00:00.000Z",
  models: {
    "mock/mimo-v2.5": {
      input: 0.000001,
      output: 0.000002,
      cacheRead: 0.0000001,
      cacheWrite: null,
    },
  },
};

// ─── fmtTokens ────────────────────────────────────────────────────────

export function testFmtTokensZero(): void {
  assert.equal(fmtTokens(0), "0");
  console.log("  ✓ fmtTokens(0) → '0'");
}

export function testFmtTokensThousands(): void {
  assert.equal(fmtTokens(1234), "1K");
  assert.equal(fmtTokens(999), "999");
  assert.equal(fmtTokens(5000), "5K");
  console.log("  ✓ fmtTokens thousands → K suffix");
}

export function testFmtTokensMillions(): void {
  assert.equal(fmtTokens(1_500_000), "1.5M");
  assert.equal(fmtTokens(10_000_000), "10.0M");
  assert.equal(fmtTokens(999_999), "1000K");
  console.log("  ✓ fmtTokens millions → M suffix");
}

// ─── fmtCost ──────────────────────────────────────────────────────────

export function testFmtCostNull(): void {
  assert.equal(fmtCost(null), "\u2014");
  console.log("  ✓ fmtCost(null) → '\u2014'");
}

export function testFmtCostZero(): void {
  assert.equal(fmtCost(0), "\u2014");
  console.log("  ✓ fmtCost(0) → '\u2014'");
}

export function testFmtCostPositive(): void {
  assert.equal(fmtCost(0.0042), "~$0.0042");
  assert.equal(fmtCost(100), "~$100.0000");
  console.log("  ✓ fmtCost positive → ~$X.XXXX");
}

// ─── fmtDelta ─────────────────────────────────────────────────────────

export function testFmtDeltaZero(): void {
  assert.equal(fmtDelta(100, 100), "");
  console.log("  ✓ fmtDelta same → ''");
}

export function testFmtDeltaPositive(): void {
  assert.equal(fmtDelta(100, 150), "+50");
  console.log("  ✓ fmtDelta increase → '+N'");
}

export function testFmtDeltaNegative(): void {
  assert.equal(fmtDelta(150, 100), "-50");
  console.log("  ✓ fmtDelta decrease → '-N'");
}

// ─── shortModel ───────────────────────────────────────────────────────

export function testShortModelJsonId(): void {
  const raw =
    '{"id":"mimo-v2.5","providerID":"opencode-go","variant":"default"}';
  assert.equal(shortModel(raw), "mimo-v2.5");
  console.log("  ✓ shortModel JSON with id → extracts id");
}

export function testShortModelJsonNoId(): void {
  const raw = '{"providerID":"opencode-go"}';
  assert.equal(shortModel(raw), raw);
  console.log("  ✓ shortModel JSON without id → raw");
}

export function testShortModelPlainText(): void {
  assert.equal(shortModel("claude-sonnet-5"), "claude-sonnet-5");
  console.log("  ✓ shortModel plain text → passthrough");
}

export function testShortModelEmptyString(): void {
  assert.equal(shortModel(""), "");
  console.log("  ✓ shortModel empty → empty");
}

// ─── cache helpers ────────────────────────────────────────────────────

function mkEntry(
  client: string,
  sessions: number,
  scannedAt: string,
): CacheEntry {
  return {
    client,
    scanned_at: scannedAt,
    session_count: sessions,
    total_tokens_input: sessions * 100,
    total_tokens_output: sessions * 50,
    total_tokens_reasoning: sessions * 10,
    total_tokens_cache_read: sessions * 30,
    total_tokens_cache_write: sessions * 5,
    total_cost: sessions * 0.1,
    by_model: [],
  };
}

export function testMergeEntriesDedup(): void {
  const existing = [
    mkEntry("opencode", 10, "2026-09-10T10:00:00Z"),
    mkEntry("zcode", 5, "2026-09-10T10:00:00Z"),
  ];
  const updated = [
    mkEntry("opencode", 12, "2026-09-11T10:00:00Z"),
    mkEntry("claude_code", 8, "2026-09-11T10:00:00Z"),
  ];
  const merged = mergeEntries(existing, updated);
  assert.equal(merged.length, 3);
  const oc = merged.find((e) => e.client === "opencode");
  assert.equal(oc?.session_count, 12, "opencode updated");
  const zc = merged.find((e) => e.client === "zcode");
  assert.equal(zc?.session_count, 5, "zcode preserved");
  const cc = merged.find((e) => e.client === "claude_code");
  assert.equal(cc?.session_count, 8, "claude_code added");
  console.log("  ✓ mergeEntries dedup by client, last wins");
}

export function testCacheMetaEmpty(): void {
  assert.equal(cacheMeta([]), null);
  console.log("  ✓ cacheMeta([]) → null");
}

export function testCacheMetaCalculatesOldest(): void {
  const entries = [
    mkEntry("opencode", 10, "2026-09-10T10:00:00Z"),
    mkEntry("zcode", 5, "2026-09-11T10:00:00Z"),
  ];
  const meta = cacheMeta(entries);
  assert.ok(meta);
  assert.equal(meta.scanned_at, "2026-09-10T10:00:00Z");
  assert.equal(meta.total_sessions, 15);
  console.log("  ✓ cacheMeta → oldest scanned_at + total sessions");
}

export function testCacheMetaProjectDimension(): void {
  // Per-worktree rows are subsets of the global aggregate — totals must come
  // from the global rows, or the header double-counts (100 → 200).
  const global = mkEntry("opencode", 100, "2026-09-12T10:00:00Z");
  const a = {
    ...mkEntry("opencode", 60, "2026-09-12T10:00:00Z"),
    worktree: "/proj/a",
  };
  const b = {
    ...mkEntry("opencode", 40, "2026-09-12T10:00:00Z"),
    worktree: "/proj/b",
  };
  const meta = cacheMeta([global, a, b]);
  assert.ok(meta);
  assert.equal(meta.total_sessions, 100);
  // Pre-dimension caches carry no worktree field — every entry counts.
  const legacy = cacheMeta([
    mkEntry("opencode", 10, "2026-09-10T10:00:00Z"),
    mkEntry("zcode", 5, "2026-09-10T10:00:00Z"),
  ]);
  assert.equal(legacy?.total_sessions, 15);
  console.log(
    "  ✓ cacheMeta → totals from global rows, legacy caches unaffected",
  );
}

export function testWriteCacheCreatesStateDir(): void {
  const prev = process.env.FAPONY_STATE_DIR;
  const dir = join(tmpdir(), `fapony-scan-test-${Date.now()}`);
  try {
    // Point at a state dir that does not exist (fresh-machine first scan).
    process.env.FAPONY_STATE_DIR = join(dir, "nested");
    writeCache([mkEntry("opencode", 2, new Date().toISOString())]);
    const back = readCache();
    assert.equal(back.length, 1);
    assert.equal(back[0].client, "opencode");
    assert.equal(back[0].session_count, 2);
  } finally {
    if (prev === undefined) delete process.env.FAPONY_STATE_DIR;
    else process.env.FAPONY_STATE_DIR = prev;
    rmSync(dir, { recursive: true, force: true });
  }
  console.log("  ✓ writeCache creates missing state dir");
}

// ─── renderUsageHtml ──────────────────────────────────────────────────

const sampleData: PassiveUsageResult = {
  total_tokens_input: 1000,
  total_tokens_output: 200,
  total_tokens_reasoning: 50,
  total_tokens_cache_read: 500,
  total_tokens_cache_write: 10,
  total_cost: 0.42,
  session_count: 5,
  by_model: [
    {
      provider: "mock",
      model: "mimo-v2.5",
      session_count: 3,
      tokens_input: 600,
      tokens_output: 120,
      tokens_reasoning: 30,
      tokens_cache_read: 300,
      tokens_cache_write: 5,
      cost: 0.3,
    },
    {
      provider: "mock",
      model: "deepseek-v4-flash",
      session_count: 2,
      tokens_input: 400,
      tokens_output: 80,
      tokens_reasoning: 20,
      tokens_cache_read: 200,
      tokens_cache_write: 5,
      cost: 0.12,
    },
  ],
};

export function testRenderHtmlStructure(): void {
  const html = renderGlobal(sampleData);
  assert.ok(html.includes("<!DOCTYPE html>"), "has doctype");
  assert.ok(html.includes("OpenCode"), "has OpenCode title");
  assert.ok(html.includes("ZCode"), "has ZCode title");
  assert.ok(html.includes("Claude Code"), "has Claude Code title");
  assert.ok(html.includes("Codex"), "has Codex title");
  assert.ok(html.includes('id="t-oc-'), "has opencode table id");
  assert.ok(html.includes('id="t-zc-'), "has zcode table id");
  assert.ok(html.includes('id="t-cc-'), "has claude table id");
  assert.ok(html.includes('id="t-cx-'), "has codex table id");
  assert.ok(!html.includes("setInterval"), "no setInterval (no polling)");
  assert.ok(!html.includes("fetch("), "no fetch() calls (no polling)");
  console.log("  ✓ renderUsageHtml → correct HTML structure (no polling)");
}

export function testRenderHtmlModelNames(): void {
  const html = renderGlobal(sampleData);
  assert.ok(html.includes("mimo-v2.5"), "renders model name");
  assert.ok(html.includes("deepseek-v4-flash"), "renders model name");
  console.log("  ✓ renderUsageHtml → model names present");
}

export function testRenderHtmlTokenValues(): void {
  const html = renderGlobal(sampleData);
  assert.ok(html.includes("1K"), "renders input tokens (1000)");
  assert.ok(
    html.includes("200") || html.includes("200"),
    "renders output tokens",
  );
  assert.ok(html.includes("3"), "renders session count");
  console.log("  ✓ renderUsageHtml → token values present");
}

export function testRenderHtmlNoData(): void {
  const html = renderGlobal(EMPTY_RESULT);
  assert.ok(html.includes("no sessions"), "shows no sessions for empty data");
  console.log("  ✓ renderUsageHtml → handles empty data");
}

export function testRenderHtmlSummaryCards(): void {
  const html = renderGlobal(sampleData, sampleData);
  assert.ok(html.includes("Cache Hit"), "has cache hit metric");
  assert.ok(html.includes("Reasoning"), "has reasoning metric");
  assert.ok(html.includes("Output"), "has output metric");
  assert.ok(html.includes("Input"), "has input metric");
  assert.ok(html.includes("Avg/Session"), "has avg per session metric");
  assert.ok(html.includes("Cost"), "has cost metric");
  console.log("  ✓ renderUsageHtml → summary cards with all metrics");
}

export function testRenderHtmlHidesEmptyCard(): void {
  // เฉพาะ opencode มี session — zcode/claude/codex ไม่มีเลย การ์ดของมันต้องไม่โผล่
  // (ตารางยังโผล่เสมอต่างจากการ์ด — h2 ของตารางมีชื่อ client เหมือนกัน
  // เทียบแค่บล็อก <div class="cards">...</div> เพื่อไม่ชนกับ h2 ของตาราง)
  const html = renderGlobal(sampleData);
  const cardsBlock = html.match(
    /<div class="cards">([\s\S]*?)<div class="share-section">/,
  )?.[1];
  assert.ok(cardsBlock, "has a cards block");
  assert.ok(cardsBlock!.includes("OpenCode"), "OpenCode card present");
  assert.ok(
    !cardsBlock!.includes("ZCode"),
    "ZCode card hidden when it has zero sessions",
  );
  assert.ok(
    !cardsBlock!.includes("Claude Code"),
    "Claude Code card hidden when it has zero sessions",
  );
  console.log("  ✓ renderUsageHtml → hides summary card with zero sessions");
}

export function testRenderHtmlCostWide(): void {
  const html = renderGlobal(sampleData);
  assert.ok(html.includes("card-metric wide"), "cost metric has wide class");
  assert.ok(html.includes("card-metric.wide"), "wide CSS rule defined");
  console.log("  ✓ renderUsageHtml → Cost metric spans 2 columns");
}

export function testRenderHtmlFreshnessBar(): void {
  const html = renderGlobal(sampleData);
  assert.ok(html.includes("data as of"), "freshness bar shows data timestamp");
  assert.ok(html.includes("usage-scan"), "freshness bar mentions usage-scan");
  assert.ok(html.includes("status fresh"), "freshness bar has status dot");
  console.log("  ✓ renderUsageHtml → freshness bar present");
}

export function testRenderHtmlNoPollInterval(): void {
  const html = renderGlobal(sampleData);
  assert.ok(!html.includes("pollInterval"), "no pollInterval in HTML");
  assert.ok(!html.includes("polling"), "no 'polling' text in HTML");
  console.log("  ✓ renderUsageHtml → no poll interval references");
}

export function testRenderHtmlShareSection(): void {
  const html = renderGlobal(sampleData);
  assert.ok(html.includes("context share (tokens)"), "share title present");
  assert.ok(html.includes("share-bar"), "share bar present");
  assert.ok(html.includes("share-legend"), "share legend present");
  console.log("  ✓ renderUsageHtml → context share section present");
}

export function testRenderHtmlReadErrorBadge(): void {
  // Zero sessions because the log could not be read — must NOT look the same
  // as a client nobody used.
  const broken = { ...EMPTY_RESULT, error: "opencode_read_failed" };
  const html = renderGlobal(broken);
  assert.ok(html.includes("could not read"), "badge text present");
  assert.ok(html.includes("opencode_read_failed"), "shows the code");
  assert.ok(html.includes("read-error"), "badge is styled, not bare text");

  // A healthy-but-unused client stays clean.
  const quiet = renderGlobal(EMPTY_RESULT);
  assert.ok(!quiet.includes("could not read"), "no badge without an error");
  console.log(
    "  ✓ renderUsageHtml → flags a client whose log could not be read",
  );
}

export function testRenderHtmlImputedCost(): void {
  const zeroCost: PassiveUsageResult = {
    ...sampleData,
    total_cost: 0,
    by_model: sampleData.by_model.map((m) => ({ ...m, cost: 0 })),
  };
  const html = renderGlobal(zeroCost, null, null, null, NOW, fixturePrices);
  assert.ok(html.includes("list-price equivalent"), "imputed note present");
  assert.ok(html.includes("~$"), "imputed cost shown for zero-cost row");
  // รุ่นที่ map ไม่ได้ต้องโผล่ใน unpriced ไม่ใช่หายเข้า 0
  assert.ok(html.includes("unpriced"), "unpriced bucket visible");
  console.log("  ✓ renderUsageHtml → imputed cost + unpriced note");
}

export function testRenderHtmlNoPricesHint(): void {
  // pin STATE_DIR ว่าง + ส่ง null ชัดเจน = ไม่มีราคา → hint ให้ price-scan
  const html = renderGlobal(sampleData, null, null, null, NOW, null);
  assert.ok(html.includes("fapony price-scan"), "hint to price-scan present");
  console.log("  ✓ renderUsageHtml → missing prices shows hint, not throw");
}

/**
 * Totals row ต้องมีจำนวน <td> เท่ากับ <th> ของ header เสมอ ไม่งั้นตัวเลข
 * เลื่อนคอลัมน์ (เคยพัง: totals ขาด placeholder ของคอลัมน์ Provider ทำให้
 * In/Out/Cache/Sess/Cost ทั้งแถวเลื่อนซ้าย 1 ช่อง)
 */
export function testRenderHtmlTotalsColumnCount(): void {
  const html = renderGlobal(sampleData);
  const headerMatch = html.match(/<thead>[\s\S]*?<\/thead>/);
  const footerMatch = html.match(/<tfoot>[\s\S]*?<\/tfoot>/);
  assert.ok(headerMatch, "has a thead");
  assert.ok(footerMatch, "has a tfoot");
  const thCount = (headerMatch![0].match(/<th>/g) ?? []).length;
  const tdCount = (footerMatch![0].match(/<td/g) ?? []).length;
  assert.equal(
    tdCount,
    thCount,
    `totals row has ${tdCount} cells, header has ${thCount} — columns would misalign`,
  );
  console.log("  ✓ renderUsageHtml → totals row column count matches header");
}
