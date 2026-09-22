// test/docs.test.ts — enum drift guard: every value in REGIME_CODES must
// appear in the docs that enumerate it, so an append to the enum fails the
// suite until the prose lists it.
//
// REASON_CODES is deliberately NOT guarded here. It belonged to verdict_submit;
// since PLAN-verdict-to-mem it lives only in the frozen ledger (consumed by
// src/stats/data.ts, locked by test/mcp/helpers.test.ts). Requiring a live doc
// to list it would drag the verdict back through the back door.
import assert from "node:assert";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { REGIME_CODES } from "../src/adapters/mcp/types.js";

const root = join(import.meta.dir, "..");

function read(rel: string): string {
  return readFileSync(join(root, rel), "utf-8");
}

/**
 * Every enum value must appear in each doc that lists the enum in full.
 * Docs without `scopes` ARE the full list — every value is checked against
 * them, so appending to the enum fails until the prose lists it (Done
 * criteria 3). Docs with `scopes` teach a deliberate subset (skills); only
 * the scoped values are checked there.
 */
function assertEnumListed(
  enumName: string,
  values: readonly string[],
  docs: Array<{ path: string; scopes?: string[] }>,
): void {
  assert.ok(values.length > 0, "enum must be non-empty");
  for (const doc of docs) {
    const content = read(doc.path);
    const want = doc.scopes ?? [...values];
    const missing = want.filter((v) => !content.includes(v));
    assert.strictEqual(
      missing.length,
      0,
      `${enumName} drift: ${doc.path} is missing [${missing.join(", ")}] — docs must list every enum value (Done criteria 3, PLAN-mem-mcp)`,
    );
  }
}

export function testRegimeCodesListedInDocs(): void {
  assertEnumListed("REGIME_CODES", REGIME_CODES, [
    { path: "CLAUDE.md" },
    { path: "README.md" },
  ]);
}

export function testAddingFakeEnumValueFailsDocsCheck(): void {
  // The mechanism itself: an enum value no doc mentions is exactly what the
  // guard above catches (Done criteria 3 — simulate one).
  const fake = ["code", "not_a_real_regime"];
  const content = read("README.md");
  const missing = fake.filter((v) => !content.includes(v));
  assert.deepStrictEqual(missing, ["not_a_real_regime"]);
}
