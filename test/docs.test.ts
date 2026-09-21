// test/docs.test.ts — enum drift guard: every value in REASON_CODES /
// REGIME_CODES must appear in the docs and skills that enumerate them, so an
// append to the enum fails the suite until the prose lists it.
import assert from "node:assert";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { REASON_CODES, REGIME_CODES } from "../src/mcp/types.js";

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

export function testReasonCodesListedInDocs(): void {
  assertEnumListed("REASON_CODES", REASON_CODES, [
    { path: "docs/mcp-handcheck.md" },
  ]);
}

export function testRegimeCodesListedInDocs(): void {
  assertEnumListed("REGIME_CODES", REGIME_CODES, [
    { path: "docs/mcp-handcheck.md" },
    { path: "CLAUDE.md" },
    { path: "README.md" },
  ]);
}

export function testAddingFakeEnumValueFailsDocsCheck(): void {
  // The mechanism itself: an enum value no doc mentions is exactly what the
  // guard above catches (Done criteria 3 — simulate one).
  const fake = ["missing_test", "not_a_real_code"];
  const content = read("docs/mcp-handcheck.md");
  const missing = fake.filter((v) => !content.includes(v));
  assert.deepStrictEqual(missing, ["not_a_real_code"]);
}
