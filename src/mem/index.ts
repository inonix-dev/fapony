// src/mem/index.ts — CLI dispatch for `fapony mem <sub>`
//
// Moved from templates/mem/mem.ts (2026-09-19) as part of PLAN-agent-one-call chunk 1.
// Now an export function called by fapony.ts, not a standalone script.

import { cmdPlanCheck, cmdPlanSweep } from "./commands/plan.js";
import { cmdDone, cmdFind, cmdKickoff, cmdStale } from "./commands/read.js";
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

const MEM_HELP = `usage: fapony mem [--mem-dir <path>] <sub> [args]

subcommands:
  where                       show the resolved mem dir and which step won
  kickoff [<plan.md>] [--pick <n>]   open a session + a next-up list
  add <kind> "<text>" --files f1,f2 [spec.md]
  close <id> "<msg>"          close a bug
  find "<text>"               substring-search every row
  done | stale              views
  claim <id> | release <id> | synced   bookkeeping
  plan-sweep [<plan.md> [--apply]]     move shipped plans + fix links
  plan-check <plan.md>        validate a plan's frontmatter/sections
  rotate                      archive the live log when it grows
  hook                        Stop-hook payload reader (installed, not run by hand)

--mem-dir <path> wins over config and the walk-up (global to every sub)
example: fapony mem add note "decided X because Y" --files src/a.ts`;

const HELP: Record<string, string> = {
  where: `usage: fapony mem where [--from <dir>]
show the .fapony/.memory dir the resolver picks and which step won — writes nothing
  --from <dir>    resolve as if cwd were here
example: fapony mem where`,
  kickoff: `usage: fapony mem kickoff [<plan.md>] [--pick <n>]
open a session and print a "next up" list (priority plans, unchecked chunks, open bugs)
  <plan.md>   plan whose first unchecked chunk is offered as a context line
  --pick <n>  run suggestion [n] non-interactively; refuses context/template items
example: fapony mem kickoff .fapony/plan/PLAN-x.md`,
  add: `usage: fapony mem add <next|bug|decision|note|hold> "<text>" --files f1,f2 [spec.md]
append one row to the mem log
  --files f1,f2   repo-relative paths this row is about (required)
  --stdin         read <text> from stdin (avoids shell metachar)
example: fapony mem add decision "chose X because Y" --files src/a.ts,src/b.ts`,
  close: `usage: fapony mem close <id> "<what was done | commit>"
tombstone a bug so it stops showing as open work
  --stdin         read the message from stdin
example: fapony mem close mt14 "fixed in a2c6beb"`,
  find: `usage: fapony mem find "<text>"
substring search over every row's text/spec/ref — all kinds, no default filter
example: fapony mem find "usage-web"`,
  done: `usage: fapony mem done
closed rows with their tombstone message
example: fapony mem done`,
  stale: `usage: fapony mem stale
decisions that never made it into their spec
example: fapony mem stale`,
  claim: `usage: fapony mem claim <id>
claim an open next|bug before working it
example: fapony mem claim mt14`,
  release: `usage: fapony mem release <id> [--stdin]
give back a claimed row without closing it
example: fapony mem release mt14`,
  synced: `usage: fapony mem synced [<spec.md>]
mark a spec as carried into the log
example: fapony mem synced .fapony/spec/SPEC-x.md`,
  "plan-sweep": `usage: fapony mem plan-sweep [<plan.md>] [--apply]
find shipped plans (or move one) and fix the links that point at it
  --apply   perform the git mv + link fixes (default = dry run)
example: fapony mem plan-sweep .fapony/plan/PLAN-x.md --apply`,
  "plan-check": `usage: fapony mem plan-check <plan.md>
validate a plan's frontmatter and required sections
example: fapony mem plan-check .fapony/plan/PLAN-x.md`,
  rotate: `usage: fapony mem rotate
archive the live log to log.YYYY-MM-DD.jsonl once it crosses the threshold
example: fapony mem rotate`,
  hook: `usage: fapony mem hook
reads the Stop-hook payload on stdin — installed by fapony, not run by hand
example: (installed hook only)`,
};

// Subcommand names for top-level did-you-mean (src/commands.ts) — derived
// from HELP keys so the list cannot drift from the dispatch below.
export const MEM_SUBCOMMANDS: string[] = Object.keys(HELP);

export async function cmdMem(a: string[], memDir?: string): Promise<void> {
  const [cmd, ...rest] = a;

  // SPEC §2: every subcommand answers --help with signature + flags + one runnable
  // example, because the reader is an agent that gets one call to get it right.
  if (cmd === "-h" || cmd === "--help") {
    console.log(MEM_HELP);
    return;
  }
  if (rest.includes("-h") || rest.includes("--help")) {
    console.log(HELP[cmd] ?? MEM_HELP);
    return;
  }

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
    cmdWhere(rest, memDir);
  } else if (cmd === "plan-sweep") {
    cmdPlanSweep(rest);
  } else if (cmd === "plan-check") {
    cmdPlanCheck(rest);
  } else if (cmd === "rotate") {
    cmdRotate(rest);
  } else {
    // bare `fapony mem` → kickoff (ranked session overview)
    cmdKickoff(rest);
  }
}
