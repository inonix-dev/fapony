// src/adapters/cli.ts — CLI dispatch: parse argv and route to feature modules
//
// Extracted from fapony.ts (PLAN-lib-layer chunk 3). The entry point
// (fapony.ts) calls cliMain(); this file owns all feature imports and the
// argv routing.

import { existsSync } from "node:fs";
import { cmdAnalyze } from "../analyze.js";
import { cmdDebt } from "../debt/cli.js";
import { cmdDigest } from "../digest/cli.js";
import { cmdInit } from "../init.js";
import { cmdInitMem } from "../init-mem.js";
import { cmdInstall } from "../install.js";
import { cmdLintBaseline } from "../lint-baseline.js";
import { cmdMem } from "../mem/index.js";
import { initStore } from "../mem/store.js";
import { cmdPriceScan } from "../price/index.js";
import { cmdReport, cmdReportWeb } from "../report/index.js";
import { cmdPlanSeed } from "../seed/plan-seed.js";
import { cmdReviewSeed } from "../seed/review-seed.js";
import { cmdSetup } from "../setup.js";
import { cmdStats } from "../stats/index.js";
import { cmdTelemetry } from "../telemetry.js";
import { cmdUpdate } from "../update.js";
import { cmdUsageScan, cmdUsageWeb } from "../usage/index.js";
import {
  cmdHookEditHint,
  cmdHookMvGuard,
  cmdHookReadHint,
  cmdHookSessionStart,
  cmdHookStop,
} from "./hooks/index.js";
import { cmdMcp } from "./mcp/transport.js";

export async function cliMain(): Promise<void> {
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
    const memDirIdx = a.indexOf("--mem-dir");
    let overrideMemDir: string | undefined;
    let rest = a;
    if (memDirIdx !== -1) {
      overrideMemDir = a[memDirIdx + 1];
      if (!overrideMemDir || overrideMemDir.startsWith("--")) {
        console.error("fapony mem: --mem-dir needs a value");
        process.exit(1);
      }
      if (!existsSync(overrideMemDir)) {
        console.error(
          `fapony mem: --mem-dir path does not exist: ${overrideMemDir}`,
        );
        process.exit(1);
      }
      rest = a.filter((_, i) => i !== memDirIdx && i !== memDirIdx + 1);
    }
    initStore(process.cwd(), overrideMemDir);
    try {
      await cmdMem(rest, overrideMemDir);
    } catch (e) {
      console.error(
        `fapony mem: ${e instanceof Error ? e.message : String(e)}`,
      );
      process.exit(1);
    }
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
  } else if (cmd === "hook-edit-hint") {
    await cmdHookEditHint();
  } else if (cmd === "hook-mv-guard") {
    await cmdHookMvGuard();
  } else if (cmd === "hook-session-start") {
    await cmdHookSessionStart();
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
  } else {
    console.error(`fapony: unknown command "${cmd ?? ""}"`);
    console.error(
      "usage: fapony <setup|update|stats|telemetry|init|init-mem|mem|install|report|report-web|usage-scan|usage-web|price-scan|analyze|debt|lint-baseline|plan-seed|review-seed|digest|mcp|hook-stop|hook-read-hint|hook-edit-hint|hook-mv-guard|hook-session-start> [args]",
    );
    process.exit(1);
  }
}
