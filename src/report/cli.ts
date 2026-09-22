// src/report/cli.ts — CLI commands for fapony report / report-web

import { spawnSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { toolVerificationReport } from "../adapters/mcp/tools/report.js";
import { parseToolResult } from "../core/types.js";
import { loadConfig } from "../db/index.js";
import { getStatsData } from "../stats/data.js";
import { renderReportHtml } from "./render.js";

export function cmdReport(args: string[]): void {
  const runId = parseInt(args[0], 10);
  if (!runId || Number.isNaN(runId)) {
    console.error("usage: fapony report <run-id>");
    process.exit(1);
  }

  const result = toolVerificationReport({ run_id: runId });
  if (result.isError) {
    const data = parseToolResult(result) as { error?: unknown };
    console.error(
      `fapony report: ${typeof data.error === "string" ? data.error : "unknown error"}`,
    );
    process.exit(1);
  }
  console.log(result.content[0].text);
}

/**
 * True when `abs` sits in a git repo and is NOT gitignored — writing the report
 * there means the generated HTML turns up in `git status` and rides along in
 * someone's next commit.
 *
 * Replaces the rule-5 refusal (dropped 2026-09-17). That check blocked any path
 * inside a *configured* worktree, which got it wrong three ways: it refused
 * paths the user had typed themselves, it missed every repo not listed in the
 * config, and it fired even when the path was already gitignored. The hazard was
 * never "inside a worktree" — it is "would be committed".
 */
export function wouldBeCommitted(abs: string): boolean {
  // check-ignore exits 0 = ignored, 1 = not ignored, 128 = not a repo.
  // A missing git, or a dir that does not exist, leaves status null — stay quiet.
  const probe = spawnSync("git", ["check-ignore", "-q", abs], {
    cwd: dirname(abs),
    stdio: "ignore",
  });
  return probe.status === 1;
}

export function cmdReportWeb(args: string[]): void {
  const config = loadConfig();
  // Accept optional --worktree <path> to scope the report to one project.
  const wtIdx = args.indexOf("--worktree");
  const worktree =
    wtIdx !== -1 && args[wtIdx + 1] ? args[wtIdx + 1] : undefined;
  // --force overrides the rule-5c refusal when the path would be committed.
  const force = args.includes("--force");
  // First positional arg is still the output file (legacy).
  const outFile =
    wtIdx !== -1
      ? args.filter((_a, i) => i !== wtIdx && i !== wtIdx + 1)[0]
      : args[0];

  // Rule 5c: refuse when the output would end up in git status. The user
  // typed the path — that makes it a commit hazard, not a prohibition case.
  // --force overrides this (for scripts that accept the risk).
  if (outFile && wouldBeCommitted(resolve(outFile))) {
    if (!force) {
      console.error(
        `fapony report-web: ${outFile} is in a git repo and not gitignored — the generated HTML would show up in git status. Add it to .gitignore, write outside the repo, or pass --force to override.`,
      );
      process.exit(1);
    }
    console.error(
      `fapony report-web: ${outFile} is in a git repo and not gitignored — --force written anyway.`,
    );
  }

  const uw = config.usageWeb ?? {};

  const ownerName = uw.ownerName?.trim() ? uw.ownerName.trim() : undefined;
  const stats = getStatsData(worktree);
  const html = renderReportHtml(stats, new Date().toISOString(), ownerName);

  if (outFile) {
    writeFileSync(outFile, html, "utf-8");
    console.log(`report written to ${outFile}`);
  } else {
    console.log(html);
  }
}
