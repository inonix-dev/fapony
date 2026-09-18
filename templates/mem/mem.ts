#!/usr/bin/env bun

// append-only memory log. Never edit old lines — close a task = close (tombstone), git = history
// the log always sits beside this file when placed by `fapony init` (<project>/.fapony/.memory/log.jsonl);
// the central copy in a monorepo (single code copy at the root) still splits logs per app: apps/<app>/.fapony/.memory/log.jsonl
// (a repo not yet migrated with an old log at apps/<app>/.memory/log.jsonl keeps reading that location)
//
// CLI entry point — all logic lives in:
//   store.ts       (types + config + rows/put)
//   selectors.ts   (openRows / claimsOf / staleReport)
//   render.ts      (fmtRow / fmtClose / printOpenRows / doneLines)
//   commands/write.ts  (add / close / claim / release / synced / hook)
//   commands/read.ts   (now / done / stale / find / kickoff)
//   commands/selftest.ts (test)

import { cmdPlanCheck, cmdPlanSweep } from "./commands/plan.js";
import {
  cmdDone,
  cmdFind,
  cmdKickoff,
  cmdNow,
  cmdStale,
} from "./commands/read.js";
import { cmdRotate } from "./commands/rotate.js";
import { cmdTest } from "./commands/selftest.js";
import {
  cmdAdd,
  cmdClaim,
  cmdClose,
  cmdHook,
  cmdRelease,
  cmdSynced,
} from "./commands/write.js";

const [cmd, ...a] = process.argv.slice(2);

if (cmd === "add") {
  await cmdAdd(a);
} else if (cmd === "close") {
  await cmdClose(a);
} else if (cmd === "claim") {
  cmdClaim(a);
} else if (cmd === "release") {
  await cmdRelease(a);
} else if (cmd === "synced") {
  cmdSynced(a);
} else if (cmd === "hook") {
  await cmdHook();
} else if (cmd === "done") {
  cmdDone();
} else if (cmd === "stale") {
  cmdStale();
} else if (cmd === "find") {
  cmdFind(a);
} else if (cmd === "test") {
  cmdTest();
} else if (cmd === "kickoff") {
  cmdKickoff(a);
} else if (cmd === "plan-sweep") {
  cmdPlanSweep(a);
} else if (cmd === "plan-check") {
  cmdPlanCheck(a);
} else if (cmd === "rotate") {
  cmdRotate(a);
} else {
  // mem now (default) — next+bug+hold. decision/note is not pending work → search with find instead
  cmdNow();
}
