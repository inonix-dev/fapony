import { test } from "bun:test";
// test/mcp/report.test.ts — tests for verification_report tool

import assert from "node:assert";
import { toolVerificationReport } from "../../src/adapters/mcp/tools/report.js";
import { parseToolResult } from "../../src/adapters/mcp/types.js";
import { newRun, openDb } from "../../src/db/store.js";
import { gateOnce } from "../../src/gate.js";
import { withTmpDb } from "../helpers.js";

test("testVerificationReportMissingArgs", () => {
  const result = toolVerificationReport({});
  assert.ok(result.isError);
  assert.ok(
    (parseToolResult(result) as { error: string }).error.includes(
      "provide run_id or worktree",
    ),
  );
  console.log("  ✓ verification_report requires run_id or worktree");
});

test("testVerificationReportRunNotFound", () => {
  withTmpDb(() => {
    const result = toolVerificationReport({ run_id: 999 });
    assert.ok(result.isError);
    assert.ok(
      (parseToolResult(result) as { error: string }).error.includes(
        "not found",
      ),
    );
    console.log("  ✓ verification_report returns error for missing run");
  });
});

test("testVerificationReportTextFormat", () => {
  withTmpDb(() => {
    // worktree that doesn't exist as git repo — facts will have git_error
    const result = toolVerificationReport({
      worktree: "/tmp",
      format: "text",
    });
    assert.equal(result.isError, undefined);
    const text = result.content[0].text;
    assert.ok(text.includes("=== Verification Report ==="));
    assert.ok(text.includes("git facts"));
    assert.ok(text.includes("verdict: (not yet)"));
    console.log("  ✓ verification_report text format renders sections");
  });
});

test("testVerificationReportJsonFormat", () => {
  withTmpDb(() => {
    const result = toolVerificationReport({
      worktree: "/tmp",
      format: "json",
    });
    assert.equal(result.isError, undefined);
    const data = parseToolResult(result) as {
      facts: unknown;
      evidence: unknown[];
      meta: { source: string };
    };
    assert.ok(data.facts);
    assert.ok(Array.isArray(data.evidence));
    assert.equal(data.meta.source, "fapony_mcp");
    console.log("  ✓ verification_report json format returns structured data");
  });
});

test("testVerificationReportWorktreeOnlyCreatesNoRun", () => {
  // A report is a read, not a unit of work — no run row, no events.
  withTmpDb(() => {
    const result = toolVerificationReport({ worktree: "/tmp" });
    assert.equal(result.isError, undefined);
    const db = openDb();
    try {
      const runs = db.prepare("SELECT COUNT(*) AS n FROM runs").get() as {
        n: number;
      };
      assert.equal(runs.n, 0, "worktree-only report must not open a run");
    } finally {
      db.close();
    }
    const data = parseToolResult(
      toolVerificationReport({ worktree: "/tmp", format: "json" }),
    ) as { meta: { run_id: number | null } };
    assert.equal(data.meta.run_id, null);
  });
  console.log("  ✓ verification_report worktree-only run leaves no trace");
});

test("testVerificationReportVerdictFromGateEvent", () => {
  withTmpDb(() => {
    // Gate events store JSON {verdict, note, round} — the report must read
    // that shape, not parse a VERDICT: marker out of it.
    // Use an absolute path as worktree so resolution skips config lookup.
    const db = openDb();
    const runId = newRun(db, "/tmp", null, null, "mcp");
    db.close();
    const gated = gateOnce(runId, "pass-good", "solid work");
    assert.equal(gated.error, undefined);

    const result = toolVerificationReport({ run_id: runId, format: "json" });
    assert.equal(result.isError, undefined);
    const data = parseToolResult(result) as {
      verdict: { grade: string; note: string } | null;
    };
    assert.ok(data.verdict, "verdict must be populated from gate event");
    assert.equal(data.verdict.grade, "pass-good");
    assert.equal(data.verdict.note, "solid work");
    console.log("  ✓ verification_report reads verdict from gate JSON event");
  });
});

test("testVerificationReportCheckParity", () => {
  withTmpDb(() => {
    // Same strictness as handoff_check on the same text: a handoff missing
    // the uncertain: line fails uncertain_not_empty (no vouching).
    const handoff = [
      "## HANDOFF",
      "claimed: abc123",
      "commits: abc123",
      "checks: typecheck pass",
    ].join("\n");
    const result = toolVerificationReport({
      worktree: "/tmp",
      handoff,
      format: "json",
    });
    assert.equal(result.isError, undefined);
    const data = parseToolResult(result) as {
      handoff_checks: {
        checks: { name: string; pass: boolean; note: string }[];
      } | null;
    };
    assert.ok(data.handoff_checks, "handoff_checks must be computed");
    const uncertain = data.handoff_checks.checks.find(
      (c) => c.name === "uncertain_not_empty",
    );
    assert.equal(
      uncertain?.pass,
      false,
      "missing uncertain field must fail like handoff_check",
    );
    console.log("  ✓ verification_report matches handoff_check strictness");
  });
});

test("testVerificationReportSurfacesCollectError", () => {
  withTmpDb(() => {
    // /tmp is not a git repo and no SHAs given → collect errors; the report
    // must surface it in git_error, not silently show zeroed facts.
    const result = toolVerificationReport({
      worktree: "/tmp",
      format: "json",
    });
    assert.equal(result.isError, undefined);
    const data = parseToolResult(result) as {
      facts: { files_changed: number; git_error: string | null };
    };
    assert.ok(
      data.facts.git_error,
      "collect failure must be visible in git_error",
    );
    console.log("  ✓ verification_report surfaces collect errors in git_error");
  });
});
