#!/usr/bin/env bun

// append-only memory log. ห้ามแก้บรรทัดเก่า — ปิดงาน = close (tombstone), git = ประวัติ
// log อยู่ข้างไฟล์นี้เสมอเมื่อถูกวางโดย `fapony init` (<project>/.fapony/.memory/log.jsonl);
// สำเนากลางใน monorepo (โค้ดชุดเดียวที่ root) ยังแยก log ราย app: apps/<app>/.fapony/.memory/log.jsonl
// (repo ที่ยังไม่ย้ายซึ่งมี log เก่าที่ apps/<app>/.memory/log.jsonl จะอ่านที่เดิมต่อ)
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
  // mem now (default) — next+bug+hold. decision/note ไม่ใช่งานค้าง → ค้นด้วย find แทน
  cmdNow();
}
