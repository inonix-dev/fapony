// src/mem/index.ts — CLI dispatch for `fapony mem <sub>`
//
// Moved from templates/mem/mem.ts (2026-09-19) as part of PLAN-agent-one-call chunk 1.
// Now an export function called by fapony.ts, not a standalone script.

import { cmdPlanCheck, cmdPlanSweep } from "./commands/plan.js";
import {
  cmdDone,
  cmdFind,
  cmdKickoff,
  cmdNow,
  cmdStale,
} from "./commands/read.js";
import { cmdRotate } from "./commands/rotate.js";
import { cmdWhere } from "./commands/where.js";
import {
  cmdAdd,
  cmdClaim,
  cmdClose,
  cmdHook,
  cmdRelease,
  cmdSynced,
} from "./commands/write.js";

export async function cmdMem(a: string[]): Promise<void> {
  const [cmd, ...rest] = a;

  if (cmd === "add") {
    await cmdAdd(rest);
  } else if (cmd === "close") {
    await cmdClose(rest);
  } else if (cmd === "claim") {
    cmdClaim(rest);
  } else if (cmd === "release") {
    await cmdRelease(rest);
  } else if (cmd === "synced") {
    cmdSynced(rest);
  } else if (cmd === "hook") {
    await cmdHook();
  } else if (cmd === "done") {
    cmdDone();
  } else if (cmd === "stale") {
    cmdStale();
  } else if (cmd === "find") {
    cmdFind(rest);
  } else if (cmd === "kickoff") {
    cmdKickoff(rest);
  } else if (cmd === "where") {
    cmdWhere(rest);
  } else if (cmd === "plan-sweep") {
    cmdPlanSweep(rest);
  } else if (cmd === "plan-check") {
    cmdPlanCheck(rest);
  } else if (cmd === "rotate") {
    cmdRotate(rest);
  } else {
    // mem now (default) — next+bug+hold. decision/note is not pending work → search with find instead
    cmdNow();
  }
}
