import { test } from "bun:test";
// test/mcp/primitives.test.ts — tests for shared verification primitives

import assert from "node:assert";
import type {
  EvidenceItem,
  VerificationReport,
} from "../../src/adapters/mcp/primitives.js";
import {
  computeEvidenceSummary,
  EVIDENCE_STATUSES,
  renderReportText,
} from "../../src/adapters/mcp/primitives.js";

// --- EVIDENCE_STATUSES ---

test("testEvidenceStatusesAreLocked", () => {
  assert.ok(EVIDENCE_STATUSES.has("passed"));
  assert.ok(EVIDENCE_STATUSES.has("failed"));
  assert.ok(EVIDENCE_STATUSES.has("not_run"));
  assert.ok(EVIDENCE_STATUSES.has("unverified"));
  assert.ok(EVIDENCE_STATUSES.has("timeout"));
  assert.equal(EVIDENCE_STATUSES.size, 5);
  console.log("  ✓ EVIDENCE_STATUSES contains all 5 locked values");
});

// --- computeEvidenceSummary ---

test("testComputeEvidenceSummaryEmpty", () => {
  const s = computeEvidenceSummary([]);
  assert.equal(s.total, 0);
  assert.equal(s.passed, 0);
  assert.equal(s.failed, 0);
  console.log("  ✓ computeEvidenceSummary empty array");
});

test("testComputeEvidenceSummaryMixed", () => {
  const items: EvidenceItem[] = [
    {
      command: "bun test",
      status: "passed",
      exit_code: 0,
      duration_ms: 1200,
      provenance: { verified: true, source: "fapony_cli" },
    },
    {
      command: "bun run typecheck",
      status: "failed",
      exit_code: 1,
      duration_ms: 3000,
      provenance: { verified: true, source: "fapony_cli" },
    },
    {
      command: "bun run lint",
      status: "not_run",
      exit_code: null,
      duration_ms: null,
      provenance: { verified: false, source: "agent_report" },
    },
    {
      command: "cargo test",
      status: "timeout",
      exit_code: null,
      duration_ms: 30000,
      provenance: { verified: true, source: "fapony_cli" },
      note: "exceeded 10s",
    },
  ];
  const s = computeEvidenceSummary(items);
  assert.equal(s.total, 4);
  assert.equal(s.passed, 1);
  assert.equal(s.failed, 1);
  assert.equal(s.not_run, 1);
  assert.equal(s.unverified, 0);
  assert.equal(s.timeout, 1);
  console.log("  ✓ computeEvidenceSummary counts mixed statuses");
});

// --- renderReportText ---

function makeReport(
  overrides?: Partial<VerificationReport>,
): VerificationReport {
  return {
    facts: {
      files_changed: 3,
      lines_changed: 120,
      insertions: 80,
      deletions: 40,
      commits: ["abc123", "def456"],
      branch: "feature/auth",
      git_error: null,
    },
    handoff_checks: null,
    evidence: [],
    evidence_summary: computeEvidenceSummary([]),
    verdict: null,
    duration_ms: null,
    rounds: 1,
    meta: {
      generated_at: "2026-09-08T12:00:00Z",
      source: "fapony_mcp",
      run_id: 42,
      server_sha: "abc1234",
    },
    ...overrides,
  };
}

test("testRenderReportTextMinimal", () => {
  const text = renderReportText(makeReport());
  assert.ok(text.includes("=== Verification Report ==="));
  assert.ok(text.includes("run: 42"));
  assert.ok(text.includes("branch: feature/auth"));
  assert.ok(text.includes("files changed: 3"));
  assert.ok(text.includes("verdict: (not yet)"));
  assert.ok(text.includes("Submit a verdict to complete verification"));
  console.log("  ✓ renderReportText minimal report");
});

test("testRenderReportTextWithPassedVerdict", () => {
  const report = makeReport({
    verdict: { grade: "pass-good", note: "looks good" },
  });
  const text = renderReportText(report);
  assert.ok(text.includes("verdict: pass-good"));
  assert.ok(text.includes("All checks passed"));
  console.log("  ✓ renderReportText with pass verdict shows next action");
});

test("testRenderReportTextWithFailingEvidence", () => {
  const evidence: EvidenceItem[] = [
    {
      command: "bun test",
      status: "failed",
      exit_code: 1,
      duration_ms: 500,
      provenance: { verified: true, source: "fapony_cli" },
    },
  ];
  const report = makeReport({
    evidence,
    evidence_summary: computeEvidenceSummary(evidence),
    verdict: { grade: "fail", note: "" },
  });
  const text = renderReportText(report);
  assert.ok(text.includes("✗ bun test"));
  assert.ok(text.includes("Fix failing evidence commands"));
  console.log("  ✓ renderReportText with failing evidence");
});

test("testRenderReportTextWithHandoffChecks", () => {
  const report = makeReport({
    handoff_checks: {
      checks: [
        { name: "has_handoff_block", pass: true, note: "" },
        {
          name: "claimed_matches_commits",
          pass: false,
          note: "commit not found",
        },
      ],
      summary: { total: 2, passed: 1, failed: 1, needs_human_review: true },
    },
  });
  const text = renderReportText(report);
  assert.ok(text.includes("1/2 passed (needs human review)"));
  assert.ok(text.includes("✓ has_handoff_block"));
  assert.ok(text.includes("✗ claimed_matches_commits"));
  assert.ok(text.includes("Review handoff conformance failures"));
  console.log("  ✓ renderReportText with handoff checks");
});

test("testRenderReportTextGitError", () => {
  const report = makeReport({
    facts: {
      ...makeReport().facts,
      git_error: "git diff failed: bad revision",
    },
  });
  const text = renderReportText(report);
  assert.ok(text.includes("⚠ git diff failed: bad revision"));
  console.log("  ✓ renderReportText shows git error warning");
});
