// src/mcp/primitives.ts — shared verification primitives
//
// Types, enums, and helpers reused by collect, check, evidence, and
// verification_report.  Keeps tool implementations thin and ensures
// consistent shapes across the MCP surface.
//
// §0 rule: add-only — never remove or rename exported symbols.

import { execSync } from "node:child_process";
import type { BlastEntry } from "../../analyze/index.js";
import { ROOT } from "../../update.js";

// ─── Server build identity ─────────────────────────────────────────────

let cachedServerSha: string | null | undefined; // undefined = not yet computed

/** Short git SHA of the fapony server itself, cached for the process life. */
export function getServerSha(): string | null {
  if (cachedServerSha !== undefined) return cachedServerSha;
  try {
    cachedServerSha = execSync("git rev-parse --short HEAD", {
      cwd: ROOT,
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
      timeout: 5_000,
    }).trim();
  } catch {
    cachedServerSha = null;
  }
  return cachedServerSha;
}

// ─── Evidence status vocabulary (locked, additive-only) ───────────────

/**
 * Evidence command result status.
 * - `passed`:   command exited 0, output matches expectation
 * - `failed`:   command exited non-zero or output mismatch
 * - `not_run`:  command not configured or explicitly skipped
 * - `unverified`: agent claim, not yet re-run by fapony
 * - `timeout`:  command exceeded per-command timeout
 */
export type EvidenceStatus =
  | "passed"
  | "failed"
  | "not_run"
  | "unverified"
  | "timeout";

export const EVIDENCE_STATUSES: ReadonlySet<string> = new Set<EvidenceStatus>([
  "passed",
  "failed",
  "not_run",
  "unverified",
  "timeout",
]);

// ─── Evidence item ────────────────────────────────────────────────────

export interface EvidenceItem {
  /** Command identity (e.g. "bun test", "bun run typecheck"). */
  command: string;
  /** Structured result status. */
  status: EvidenceStatus;
  /** Exit code, or null when not_run / timeout / refused by safety gate. */
  exit_code: number | null;
  /** Wall-clock duration in ms, or null when not_run / refused. */
  duration_ms: number | null;
  /** Where the result came from. */
  provenance: EvidenceProvenance;
  /** Optional note (reason for not_run, truncated output, etc.). */
  note?: string;
}

// ─── Provenance ───────────────────────────────────────────────────────

export interface EvidenceProvenance {
  /** true = fapony ran the command itself; false = agent claim. */
  verified: boolean;
  /** Source identifier: "fapony_cli", "agent_report", "config_allowlist". */
  source: string;
}

// ─── Check result (shared by handoff_check + verification_report) ─────

export interface CheckResult {
  name: string;
  pass: boolean;
  note: string;
}

// ─── Report summary ───────────────────────────────────────────────────

export interface EvidenceSummary {
  total: number;
  passed: number;
  failed: number;
  not_run: number;
  unverified: number;
  timeout: number;
}

export function computeEvidenceSummary(items: EvidenceItem[]): EvidenceSummary {
  const s: EvidenceSummary = {
    total: items.length,
    passed: 0,
    failed: 0,
    not_run: 0,
    unverified: 0,
    timeout: 0,
  };
  for (const item of items) {
    s[item.status]++;
  }
  return s;
}

// ─── Verification report contract ─────────────────────────────────────

/**
 * Full verification report — the single object returned by
 * `verification_report` MCP tool and rendered by CLI.
 *
 * Design: compose-only — aggregates results from existing primitives
 * (handoff_collect, handoff_check, verdict, stats) plus evidence
 * collection.  No new parser/conformance logic.
 */
export interface VerificationReport {
  /** Git facts from handoff_collect (verified by fapony). */
  facts: {
    files_changed: number;
    lines_changed: number;
    insertions: number;
    deletions: number;
    commits: string[];
    branch: string;
    git_error: string | null;
    /** Changed file paths (from handoff_collect) — absent on old reports. */
    files?: string[];
  };
  /** Handoff conformance checks (from handoff_check). */
  handoff_checks: {
    checks: CheckResult[];
    summary: {
      total: number;
      passed: number;
      failed: number;
      needs_human_review: boolean;
    };
  } | null;
  /**
   * Blast radius of the changed files (from `fapony analyze` graph, live).
   * Null/absent when no files[] or the worktree can't be scanned.
   */
  blast_radius?: Record<string, BlastEntry> | null;
  /** Evidence items (test, typecheck, lint, etc.). */
  evidence: EvidenceItem[];
  /** Evidence summary (computed from evidence array). */
  evidence_summary: EvidenceSummary;
  /** Verdict grade + note (from the frozen gate/verdict ledger, or null if never graded). */
  verdict: {
    grade: string;
    note: string;
  } | null;
  /** Run duration in ms (created_at → updated_at), or null. */
  duration_ms: number | null;
  /** Number of rounds executed. */
  rounds: number;
  /** Report metadata. */
  meta: {
    /** ISO-8601 timestamp of report generation. */
    generated_at: string;
    /** Provenance: who produced this report. */
    source: "fapony_mcp" | "fapony_cli";
    /** Run ID this report is for. */
    run_id: number | null;
    /**
     * Short git SHA of the fapony server process itself (not the worktree
     * being reviewed), captured once at first use and cached for the life
     * of the process. Lets a reader compare against `git log -1` in the
     * fapony repo to catch a stale (pre-edit) server still answering.
     * Null when fapony isn't running from a git checkout.
     */
    server_sha: string | null;
  };
}

// ─── Text renderer ────────────────────────────────────────────────────

function fmtDuration(ms: number | null): string {
  if (ms === null) return "—";
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  return `${(ms / 60_000).toFixed(1)}m`;
}

function statusIcon(s: EvidenceStatus): string {
  switch (s) {
    case "passed":
      return "✓";
    case "failed":
      return "✗";
    case "not_run":
      return "○";
    case "unverified":
      return "?";
    case "timeout":
      return "⏱";
  }
}

/**
 * Render VerificationReport as human-readable text.
 * Same data as JSON — never disagrees.
 */
export function renderReportText(report: VerificationReport): string {
  const lines: string[] = [];

  lines.push("=== Verification Report ===");
  lines.push(
    `run: ${report.meta.run_id ?? "(none)"}  generated: ${report.meta.generated_at}`,
  );
  lines.push(
    `fapony server: ${report.meta.server_sha ?? "(unknown — not a git checkout)"}  — compare with \`git log -1\` in the fapony repo`,
  );
  lines.push("");

  // --- Git facts ---
  lines.push("--- git facts ---");
  if (report.facts.git_error) {
    lines.push(`⚠ ${report.facts.git_error}`);
  }
  lines.push(`branch: ${report.facts.branch}`);
  lines.push(`files changed: ${report.facts.files_changed}`);
  lines.push(`lines changed: ${report.facts.lines_changed}`);
  lines.push(
    `commits: ${report.facts.commits.length ? report.facts.commits.join(", ") : "(none)"}`,
  );

  // --- Blast radius ---
  if (report.blast_radius && Object.keys(report.blast_radius).length > 0) {
    lines.push("");
    lines.push("--- blast radius ---");
    for (const [file, b] of Object.entries(report.blast_radius)) {
      const flag = b.tested ? "tested" : "⚠ no test imports it";
      lines.push(
        `  ${file}: ${b.dependents} dependent${b.dependents === 1 ? "" : "s"} — ${flag}`,
      );
    }
  }

  // --- Handoff checks ---
  if (report.handoff_checks) {
    lines.push("");
    lines.push("--- handoff conformance ---");
    const hs = report.handoff_checks.summary;
    lines.push(
      `${hs.passed}/${hs.total} passed${hs.needs_human_review ? " (needs human review)" : ""}`,
    );
    for (const c of report.handoff_checks.checks) {
      const icon = c.pass ? "✓" : "✗";
      lines.push(`  ${icon} ${c.name}${c.note ? ` — ${c.note}` : ""}`);
    }
  }

  // --- Evidence ---
  lines.push("");
  lines.push("--- evidence ---");
  if (report.evidence.length === 0) {
    lines.push("not_run (no evidence allowlist found)");
  } else {
    const es = report.evidence_summary;
    lines.push(
      `${es.passed} passed, ${es.failed} failed, ${es.not_run} not run, ${es.unverified} unverified, ${es.timeout} timeout`,
    );
    for (const item of report.evidence) {
      const dur =
        item.duration_ms !== null ? ` (${fmtDuration(item.duration_ms)})` : "";
      const note = item.note ? ` — ${item.note}` : "";
      lines.push(`  ${statusIcon(item.status)} ${item.command}${dur}${note}`);
    }
  }

  // --- Verdict ---
  lines.push("");
  if (report.verdict) {
    lines.push(`--- verdict: ${report.verdict.grade} ---`);
    if (report.verdict.note) lines.push(report.verdict.note);
  } else {
    lines.push("--- verdict: (not yet) ---");
  }

  // --- Duration & rounds ---
  lines.push("");
  lines.push(
    `duration: ${fmtDuration(report.duration_ms)}  rounds: ${report.rounds}`,
  );

  // --- Next action ---
  lines.push("");
  lines.push("--- next action ---");
  if (report.verdict?.grade.startsWith("pass")) {
    lines.push("All checks passed. No action needed.");
  } else if (report.evidence_summary.failed > 0) {
    lines.push("Fix failing evidence commands, then re-run verification.");
  } else if (report.evidence_summary.unverified > 0) {
    lines.push("Re-run unverified items or accept agent claims with caution.");
  } else if (report.handoff_checks?.summary.needs_human_review) {
    lines.push("Review handoff conformance failures above.");
  } else if (!report.verdict) {
    lines.push("Submit a verdict to complete verification.");
  } else {
    lines.push("Review the report and decide next steps.");
  }

  return lines.join("\n");
}
