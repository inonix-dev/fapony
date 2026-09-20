// test/mcp/report.test.ts — tests for verification_report tool

import assert from "node:assert";
import { newRun, openDb } from "../../src/db/index.js";
import { gateOnce } from "../../src/gate.js";
import { toolVerificationReport } from "../../src/mcp/tools/report.js";
import { parseToolResult } from "../../src/mcp/types.js";
import { withTmpDb } from "../helpers.js";

export function testVerificationReportMissingArgs(): void {
  const result = toolVerificationReport({});
  assert.ok(result.isError);
  assert.ok(
    (parseToolResult(result) as { error: string }).error.includes(
      "provide run_id or worktree",
    ),
  );
  console.log("  ✓ verification_report requires run_id or worktree");
}

export function testVerificationReportRunNotFound(): void {
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
}

export function testVerificationReportTextFormat(): void {
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
}

export function testVerificationReportJsonFormat(): void {
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
}

export function testVerificationReportWorktreeOnlyCreatesNoRun(): void {
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
}

export function testVerificationReportToolCount(): void {
  // The handoff trio is CLI-only: the logic below still ships (fapony report
  // calls toolVerificationReport directly), but the MCP schemas cost every
  // session of every client and nothing called them. Guard the boundary.
  const { TOOLS } =
    require("../../src/mcp/tools/index.js") as typeof import("../../src/mcp/tools/index.js");
  const names = TOOLS.map((t: { name: string }) => t.name);
  for (const gone of [
    "verification_report",
    "handoff_check",
    "handoff_collect",
    // dropped 2026-09-19: `fapony stats` covers one from the CLI, the other
    // had no caller — a schema on tools/list is paid every session by everyone.
    "fapony_stats",
    "project_health_context",
    // dropped 2026-09-20: `fapony mem kickoff` answers "what is left" from the
    // same plan files, so the schema was rent with no tenant.
    "plan_list",
    // dropped 2026-09-20: only the owner ever asked ("what did it cost"),
    // never the agent mid-turn — and `fapony usage-web` answers it from the
    // CLI with zero standing rent.
    "fapony_usage",
  ]) {
    assert.ok(!names.includes(gone), `${gone} is back on the MCP surface`);
  }
  assert.equal(TOOLS.length, 3);
  console.log("  ✓ retired tools stay off the MCP surface (3 tools total)");
}

export function testVerificationReportVerdictFromGateEvent(): void {
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
}

export function testVerificationReportCheckParity(): void {
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
}

export function testVerificationReportSurfacesCollectError(): void {
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
}
