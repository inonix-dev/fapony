#!/usr/bin/env bun

// fapony — measure/verify MCP server for coding agents
// CLI dispatch: all logic lives in src/

import { cmdAnalyze } from "./src/analyze.js";
import { cmdDebt } from "./src/debt.js";
import { cmdDigest } from "./src/digest/cli.js";
import { cmdHookReadHint, cmdHookStop } from "./src/hook.js";
import { cmdInit } from "./src/init.js";
import { cmdInitMem } from "./src/init-mem.js";
import { cmdInstall } from "./src/install.js";
import { cmdLintBaseline } from "./src/lint-baseline.js";
import { cmdMcp } from "./src/mcp/transport.js";
import { cmdMem } from "./src/mem/index.js";
import { initStore } from "./src/mem/store.js";
import { cmdPlanSeed } from "./src/plan-seed.js";
import { cmdPriceScan } from "./src/price/index.js";
import { cmdReport, cmdReportWeb } from "./src/report/index.js";
import { cmdReviewSeed } from "./src/review-seed.js";
import { cmdSetup } from "./src/setup.js";
import { cmdStats } from "./src/stats/index.js";
import { cmdTelemetry } from "./src/telemetry.js";
import { cmdUpdate } from "./src/update.js";
import { cmdUsageScan, cmdUsageWeb } from "./src/usage/index.js";

const [cmd, ...a] = process.argv.slice(2);

if (cmd === "analyze") {
  cmdAnalyze(a);
} else if (cmd === "debt") {
  cmdDebt(a);
} else if (cmd === "lint-baseline") {
  cmdLintBaseline(a);
} else if (cmd === "plan-seed") {
  cmdPlanSeed(a);
} else if (cmd === "review-seed") {
  cmdReviewSeed(a);
} else if (cmd === "digest") {
  await cmdDigest(a);
} else if (cmd === "stats") {
  cmdStats(a);
} else if (cmd === "telemetry") {
  await cmdTelemetry(a);
} else if (cmd === "init-mem") {
  cmdInitMem(a);
} else if (cmd === "mem") {
  // Parse --mem-dir flag before passing to cmdMem
  let overrideMemDir: string | undefined;
  const memDirIdx = a.indexOf("--mem-dir");
  if (memDirIdx !== -1) {
    overrideMemDir = a[memDirIdx + 1];
  }
  const filteredA = overrideMemDir
    ? a.filter((_, i) => i !== memDirIdx && i !== memDirIdx + 1)
    : a;
  initStore(process.cwd(), overrideMemDir);
  await cmdMem(filteredA);
} else if (cmd === "init") {
  await cmdInit(a);
} else if (cmd === "install") {
  await cmdInstall(a);
} else if (cmd === "setup") {
  await cmdSetup();
} else if (cmd === "update") {
  await cmdUpdate();
} else if (cmd === "hook-stop") {
  await cmdHookStop();
} else if (cmd === "hook-read-hint") {
  await cmdHookReadHint();
} else if (cmd === "mcp") {
  cmdMcp();
} else if (cmd === "report") {
  cmdReport(a);
} else if (cmd === "report-web") {
  cmdReportWeb(a);
} else if (cmd === "usage-scan") {
  cmdUsageScan(a);
} else if (cmd === "price-scan") {
  await cmdPriceScan(a);
} else if (cmd === "usage-web") {
  cmdUsageWeb(a);
} else if (cmd === "test") {
  // dynamic: src/test.js re-exports test/index.js, which the npm package
  // doesn't ship (repo self-check only, not a published command) — a static
  // import here would fail module load for every command, not just this one
  const { cmdTest } = await import("./src/test.js");
  await cmdTest();
} else {
  console.error(`fapony: unknown command "${cmd ?? ""}"`);
  console.error(
    "usage: fapony <setup|update|stats|telemetry|init|init-mem|mem|install|report|report-web|usage-scan|usage-web|price-scan|analyze|debt|lint-baseline|plan-seed|review-seed|digest|mcp|hook-stop|hook-read-hint|test> [args]",
  );
  process.exit(1);
}
