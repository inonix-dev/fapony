#!/usr/bin/env bun

// fapony — measure/verify MCP server for coding agents
// CLI dispatch: all logic lives in src/

import { cmdAnalyze } from "./src/analyze.js";
import { cmdDigest } from "./src/digest/cli.js";
import { cmdHookStop } from "./src/hook.js";
import { cmdInit } from "./src/init.js";
import { cmdInitMem } from "./src/init-mem.js";
import { cmdInstall } from "./src/install.js";
import { cmdMap } from "./src/map.js";
import { cmdMcp } from "./src/mcp/transport.js";
import { cmdPlanSeed } from "./src/plan-seed.js";
import { cmdPriceScan } from "./src/price/index.js";
import { cmdReport, cmdReportWeb } from "./src/report/index.js";
import { cmdReviewSeed } from "./src/review-seed.js";
import { cmdSetup } from "./src/setup.js";
import { cmdStats } from "./src/stats/index.js";
import { cmdTelemetry } from "./src/telemetry.js";
import { cmdTest } from "./src/test.js";
import { cmdUpdate } from "./src/update.js";
import { cmdUsageScan, cmdUsageWeb } from "./src/usage/index.js";

const [cmd, ...a] = process.argv.slice(2);

if (cmd === "analyze") {
  cmdAnalyze(a);
} else if (cmd === "map") {
  cmdMap(a);
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
  await cmdTest();
} else {
  console.error(`fapony: unknown command "${cmd ?? ""}"`);
  console.error(
    "usage: fapony <setup|update|stats|telemetry|init|init-mem|install|report|report-web|usage-scan|usage-web|price-scan|analyze|map|plan-seed|review-seed|digest|mcp|hook-stop|test> [args]",
  );
  process.exit(1);
}
