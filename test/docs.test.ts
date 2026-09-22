import { test } from "bun:test";
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
import { COMMANDS } from "../src/commands.js";

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

test("testRegimeCodesListedInDocs", () => {
  assertEnumListed("REGIME_CODES", REGIME_CODES, [
    { path: "CLAUDE.md" },
    { path: "README.md" },
  ]);
});

test("testAddingFakeEnumValueFailsDocsCheck", () => {
  // The mechanism itself: an enum value no doc mentions is exactly what the
  // guard above catches (Done criteria 3 — simulate one).
  const fake = ["code", "not_a_real_regime"];
  const content = read("README.md");
  const missing = fake.filter((v) => !content.includes(v));
  assert.deepStrictEqual(missing, ["not_a_real_regime"]);
});

/**
 * Every top-level command name in src/commands.ts must appear in the docs
 * that enumerate the CLI, so adding a command fails the suite until the
 * prose lists it (Done criteria 2, PLAN-seed-and-surface chunk 3). Names
 * only, never prose — a test that checks wording goes red on every rephrase
 * and gets deleted.
 */
function assertCommandsListed(): void {
  assert.ok(COMMANDS.length > 0, "COMMANDS must be non-empty");
  const claude = read("CLAUDE.md");
  const readme = read("README.md");
  for (const c of COMMANDS) {
    assert.ok(
      claude.includes(c.name),
      `COMMANDS drift: CLAUDE.md §CLI Commands is missing "${c.name}" — list every command there (chunk 3)`,
    );
    assert.ok(
      readme.includes(c.name),
      `COMMANDS drift: README.md §CLI is missing "${c.name}" — list every command there (chunk 3)`,
    );
  }
}

test("testCommandsListedInDocs", () => {
  assertCommandsListed();
});

test("testAddingFakeCommandFailsDocsCheck", () => {
  // The mechanism itself: a command name no doc mentions is exactly what the
  // guard above catches (simulate one).
  const fake = "not_a_real_command";
  assert.ok(!read("CLAUDE.md").includes(fake));
  assert.ok(!read("README.md").includes(fake));
});

/**
 * Reverse direction: every `fapony <name>` inside the CLI fences must exist
 * in src/commands.ts. The forward guard (table → docs) cannot catch a phantom
 * the docs advertise but the code never had — `fapony test` survived it
 * exactly this way (mucplzjo: removed from cli.ts in 2ddd61e, docs left
 * behind). Scoped to fenced blocks under the CLI sections so prose and
 * historical mentions (e.g. `plan-list` in MCP history) don't trip it.
 */
function cliFenceCommands(doc: string, header: string): string[] {
  const lines = doc.split("\n");
  const start = lines.findIndex((l) => l.trim() === header);
  assert.ok(start >= 0, `${header} section not found`);
  let end = lines.findIndex((l, i) => i > start && l.startsWith("## "));
  if (end < 0) end = lines.length;
  const names: string[] = [];
  let inFence = false;
  for (const line of lines.slice(start, end)) {
    if (line.trimStart().startsWith("```")) {
      inFence = !inFence;
      continue;
    }
    if (!inFence) continue;
    for (const m of line.matchAll(/fapony\s+([a-z][a-z-]*)/g)) names.push(m[1]);
  }
  return names;
}

test("testDocsAdvertiseNoPhantomCommands", () => {
  const known = new Set(COMMANDS.map((c) => c.name));
  const found = [
    ...cliFenceCommands(read("CLAUDE.md"), "## CLI Commands"),
    ...cliFenceCommands(read("README.md"), "## CLI"),
  ];
  assert.ok(found.length > 0, "expected fapony <cmd> mentions in CLI fences");
  for (const n of found) {
    assert.ok(
      known.has(n),
      `phantom command: docs advertise "fapony ${n}" but src/commands.ts has no such command (mucplzjo)`,
    );
  }
});
