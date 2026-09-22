import { test } from "bun:test";
// test/mcp/check.test.ts — tests for handoff_check tool + extractMultiField

import assert from "node:assert";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  extractMultiField,
  toolHandoffCheck,
} from "../../src/adapters/mcp/tools/check.js";
import { parseToolResult } from "../../src/adapters/mcp/types.js";

// --- handoff_check tests ---

test("testHandoffCheckMissingBlock", () => {
  const result = toolHandoffCheck({ handoff: "no handoff here" });
  const data = parseToolResult(result) as {
    checks: { name: string; pass: boolean }[];
    summary: { total: number; failed: number };
  };
  assert.equal(data.checks.length, 1);
  assert.equal(data.checks[0].name, "has_handoff_block");
  assert.equal(data.checks[0].pass, false);
  assert.equal(data.summary.failed, 1);
  console.log("  ✓ handoff_check detects missing block");
});

test("testHandoffCheckGoodHandoff", () => {
  const handoff = [
    "Some output",
    "## HANDOFF",
    "claimed: abc123",
    "commits: abc123 def456",
    "checks: typecheck pass",
    "uncertain: none",
    "not_done: none",
  ].join("\n");

  const facts = { commits: ["abc123", "def456"] };
  // Agent-reported fields provided as separate args
  const result = toolHandoffCheck({
    handoff,
    facts,
    uncertain: "none",
    not_done: "none",
    checks: "typecheck pass",
  });
  const data = parseToolResult(result) as {
    checks: { name: string; pass: boolean }[];
    summary: { total: number; passed: number; failed: number };
  };
  assert.equal(data.summary.total, 6);
  assert.equal(data.summary.passed, 6);
  assert.equal(data.summary.failed, 0);
  console.log("  ✓ handoff_check passes for good handoff");
});

test("testHandoffCheckUncertainFails", () => {
  const handoff = [
    "## HANDOFF",
    "claimed: abc123",
    "commits: abc123",
    "checks: typecheck pass",
    "uncertain: auth flow might need refactoring",
    "not_done: none",
  ].join("\n");

  const facts = { commits: ["abc123"] };
  const result = toolHandoffCheck({
    handoff,
    facts,
    uncertain: "auth flow might need refactoring",
    not_done: "none",
    checks: "typecheck pass",
  });
  const data = parseToolResult(result) as {
    checks: { name: string; pass: boolean }[];
    summary: { failed: number };
  };
  const uncertainCheck = data.checks.find(
    (c) => c.name === "uncertain_not_empty",
  );
  assert.equal(uncertainCheck?.pass, false);
  assert.equal(data.summary.failed, 1);
  console.log("  ✓ handoff_check fails when uncertainty reported");
});

test("testHandoffCheckNotDoneFails", () => {
  const handoff = [
    "## HANDOFF",
    "claimed: abc123",
    "commits: abc123",
    "checks: typecheck pass",
    "uncertain: none",
    "not_done: tests",
  ].join("\n");

  const facts = { commits: ["abc123"] };
  const result = toolHandoffCheck({
    handoff,
    facts,
    uncertain: "none",
    not_done: "tests",
    checks: "typecheck pass",
  });
  const data = parseToolResult(result) as {
    checks: { name: string; pass: boolean }[];
  };
  const notDoneCheck = data.checks.find((c) => c.name === "not_done_not_empty");
  assert.equal(notDoneCheck?.pass, false);
  console.log("  ✓ handoff_check fails when not_done reported");
});

test("testHandoffCheckWithFactsCrossRef", () => {
  const handoff = [
    "## HANDOFF",
    "claimed: abc123",
    "commits: abc123 def456",
    "checks: pass",
    "uncertain: none",
    "not_done: none",
  ].join("\n");

  const facts = { commits: ["abc123", "def456"] };
  const result = toolHandoffCheck({
    handoff,
    facts,
    uncertain: "none",
    not_done: "none",
    checks: "pass",
  });
  const data = parseToolResult(result) as {
    checks: { name: string; pass: boolean }[];
  };
  const crossRef = data.checks.find((c) => c.name === "facts_cross_referenced");
  assert.equal(crossRef?.pass, true);
  console.log("  ✓ handoff_check cross-references facts");
});

test("testHandoffCheckWithoutFacts", () => {
  const handoff = [
    "## HANDOFF",
    "claimed: abc123",
    "commits: abc123",
    "checks: pass",
    "uncertain: none",
    "not_done: none",
  ].join("\n");

  const result = toolHandoffCheck({
    handoff,
    uncertain: "none",
    not_done: "none",
    checks: "pass",
  });
  const data = parseToolResult(result) as {
    checks: { name: string; pass: boolean; note: string }[];
  };
  const crossRef = data.checks.find((c) => c.name === "facts_cross_referenced");
  // When no facts provided, the check is skipped entirely (not in checks array)
  assert.equal(crossRef, undefined);
  console.log("  ✓ handoff_check skips facts_cross_referenced when no facts");
});

test("testHandoffCheckAutoGenerate", () => {
  const facts = { commits: ["abc123", "def456"] };
  // Agent provides uncertain/not_done/checks → used in handoff
  const result = toolHandoffCheck({
    auto_generate: true,
    facts,
    uncertain: "none",
    not_done: "none",
    checks: "typecheck pass",
  });
  const data = parseToolResult(result) as {
    checks: { name: string; pass: boolean }[];
    summary: { total: number; failed: number };
  };
  // All checks pass because agent reported them
  assert.equal(data.summary.failed, 0);
  console.log(
    "  ✓ handoff_check auto-generates claimed/commits, uses agent uncertain/not_done/checks",
  );
});

test("testHandoffCheckAutoGenerateRequiresAgentReport", () => {
  const facts = { commits: ["abc123", "def456"] };
  // Agent does NOT provide uncertain/not_done/checks → all 3 fail
  const result = toolHandoffCheck({ auto_generate: true, facts });
  const data = parseToolResult(result) as {
    checks: { name: string; pass: boolean; note: string }[];
    summary: { failed: number };
  };
  // uncertain_not_empty fails, not_done_not_empty fails, checks_declared fails
  assert.ok(data.summary.failed >= 3);
  const checksDecl = data.checks.find((c) => c.name === "checks_declared");
  assert.equal(checksDecl?.pass, false);
  assert.ok(checksDecl?.note.includes("did not report"));
  console.log(
    "  ✓ handoff_check auto_generate without agent report fails all 3 checks",
  );
});

test("testHandoffCheckAutoGenerateWithUncertainty", () => {
  const facts = { commits: ["abc123"] };
  // Agent reports uncertainty → uncertain_not_empty fails
  const result = toolHandoffCheck({
    auto_generate: true,
    facts,
    uncertain: "auth flow might need refactoring",
    not_done: "none",
    checks: "pass",
  });
  const data = parseToolResult(result) as {
    checks: { name: string; pass: boolean }[];
    summary: { failed: number };
  };
  assert.equal(data.summary.failed, 1); // only uncertain fails
  console.log(
    "  ✓ handoff_check auto_generate catches agent-reported uncertainty",
  );
});

test("testHandoffCheckMultiLineUncertain", () => {
  const handoff = [
    "## HANDOFF",
    "claimed: abc123",
    "commits: abc123",
    "checks: pass",
    "uncertain: first issue",
    "  also second issue",
    "not_done: none",
  ].join("\n");

  const result = toolHandoffCheck({
    handoff,
    uncertain: "first issue\n  also second issue",
    not_done: "none",
    checks: "pass",
  });
  const data = parseToolResult(result) as {
    checks: { name: string; pass: boolean; note: string }[];
  };
  const uncertainCheck = data.checks.find(
    (c) => c.name === "uncertain_not_empty",
  );
  assert.equal(uncertainCheck?.pass, false);
  assert.ok(uncertainCheck?.note.includes("first issue"));
  assert.ok(uncertainCheck?.note.includes("also second issue"));
  console.log("  ✓ handoff_check handles multi-line uncertain");
});

// --- extractMultiField tests ---

test("testExtractMultiFieldNone", () => {
  const result = extractMultiField("uncertain: none", "uncertain");
  assert.deepEqual(result, []);
  console.log("  ✓ extractMultiField returns [] for 'none'");
});

test("testExtractMultiFieldSingle", () => {
  const result = extractMultiField("uncertain: maybe so", "uncertain");
  assert.deepEqual(result, ["maybe so"]);
  console.log("  ✓ extractMultiField single line");
});

test("testExtractMultiFieldMultiLine", () => {
  const text = [
    "## HANDOFF",
    "claimed: x",
    "uncertain: first issue",
    "  also second issue",
    "  and third",
    "not_done: none",
  ].join("\n");
  const result = extractMultiField(text, "uncertain");
  assert.deepEqual(result, ["first issue", "also second issue", "and third"]);
  console.log("  ✓ extractMultiField multi-line");
});

test("testExtractMultiFieldEmptyLineEndsField", () => {
  const text = ["uncertain: first issue", "", "not_done: leftover"].join("\n");
  const result = extractMultiField(text, "uncertain");
  assert.deepEqual(result, ["first issue"]);
  console.log("  ✓ extractMultiField stops at empty line");
});

test("testExtractMultiFieldNotFound", () => {
  const result = extractMultiField("claimed: x", "uncertain");
  assert.deepEqual(result, []);
  console.log("  ✓ extractMultiField returns [] when field missing");
});

test("testHandoffCheckBlastRadiusWithWorktree", () => {
  // Create a minimal TS project: hub imported by 3 non-test files
  const dir = mkdtempSync(join(tmpdir(), "fapony-check-"));
  try {
    writeFileSync(join(dir, "hub.ts"), "export const x = 1;\n");
    writeFileSync(join(dir, "a.ts"), 'import { x } from "./hub.js";\n');
    writeFileSync(join(dir, "b.ts"), 'import { x } from "./hub.js";\n');
    writeFileSync(join(dir, "c.ts"), 'import { x } from "./hub.js";\n');

    const handoff = [
      "## HANDOFF",
      "claimed: none",
      "commits: none",
      "checks: bun run check",
      "uncertain: none",
      "not_done: none",
    ].join("\n");

    const result = toolHandoffCheck({
      handoff,
      uncertain: "none",
      not_done: "none",
      checks: "bun run check",
      worktree: dir,
      facts: { commits: [], files: ["hub.ts"] },
    });

    assert.equal(result.isError, undefined);
    const data = parseToolResult(result) as {
      blast_radius: Record<string, { dependents: number; tested: boolean }>;
    };
    assert.ok(data.blast_radius, "blast_radius must be present");
    assert.equal(data.blast_radius["hub.ts"].dependents, 3);
    assert.equal(data.blast_radius["hub.ts"].tested, false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  console.log("  ✓ handoff_check computes blast_radius when worktree provided");
});

test("testHandoffCheckNoBlastRadiusWithoutWorktree", () => {
  const handoff = [
    "## HANDOFF",
    "claimed: none",
    "commits: none",
    "checks: bun run check",
    "uncertain: none",
    "not_done: none",
  ].join("\n");

  const result = toolHandoffCheck({
    handoff,
    uncertain: "none",
    not_done: "none",
    checks: "bun run check",
    facts: { commits: [], files: ["hub.ts"] },
  });

  assert.equal(result.isError, undefined);
  const data = parseToolResult(result) as {
    blast_radius?: Record<string, unknown>;
  };
  assert.ok(
    data.blast_radius === null || data.blast_radius === undefined,
    "blast_radius must be absent without worktree",
  );
  console.log("  ✓ handoff_check omits blast_radius when worktree absent");
});
