// src/mem/index.ts — CLI dispatch for `fapony mem <sub>`
//
// Moved from templates/mem/mem.ts (2026-09-19) as part of PLAN-agent-one-call chunk 1.
// Now an export function called by fapony.ts, not a standalone script.

import { existsSync } from "node:fs";
import { basename, join } from "node:path";
import { levenshtein } from "../commands.js";
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
import { doneDir, planDir } from "./store.js";

const MEM_HELP = `usage: fapony mem [--mem-dir <path>] <sub> [args]

subcommands:
  where                       show the resolved mem dir and which step won
  kickoff [<plan.md>] [--pick <n>]   open a session + a next-up list
  add <kind> "<text>" --files f1,f2 [--key k] [spec.md]
  close <id> "<msg>"          close a bug
  find ["<text>"] [--kind a,b] [--files f1,f2] [--since <N>d|YYYY-MM-DD] [--limit n]
                          substring-search every row (archives included)
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
  add: `usage: fapony mem add <next|bug|decision|note|hold> "<text>" --files f1,f2 [--key k] [spec.md]
append one row to the mem log
  --files f1,f2   repo-relative paths this row is about (required)
  --key k         problem identity, [a-z0-9-]{3,40} — same problem = same key (optional)
  --stdin         read <text> from stdin (avoids shell metachar)
example: fapony mem add decision "chose X because Y" --files src/a.ts,src/b.ts --key unify-mem-engine`,
  close: `usage: fapony mem close <id> "<what was done | commit>"
tombstone a bug so it stops showing as open work
  --stdin         read the message from stdin
example: fapony mem close mt14 "fixed in a2c6beb"`,
  find: `usage: fapony mem find ["<text>"] [--kind a,b] [--files f1,f2] [--since <N>d|YYYY-MM-DD] [--limit n]
substring search over every row's text/spec/ref (rotated archives included) — bookkeeping kinds (close/synced/claim/release) hidden unless --kind names them
  --kind a,b    include only these kinds (overrides the bookkeeping default)
  --files f1,f2 rows about these paths (stored files[] first, text/spec/ref fallback)
  --since 7d    only rows at or after this time (<N>d or YYYY-MM-DD)
  --limit n     max rows returned (default 20, newest first)
example: fapony mem find "usage-web" --kind bug,decision --limit 5`,
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

// Chunk 7 (PLAN-seed-and-surface, bug muc85pml): `fapony mem now` used to fall
// through to kickoff and print an overview ("N entries") instead of an error —
// a typo that looks like success. Three rules, in order:
//   1. a known subcommand → dispatch (unchanged)
//   2. looks like a plan path (.md suffix, a slash, or a file with that name
//      in planDir/doneDir) → kickoff — this is `fapony mem PLAN-x.md`, which
//      must keep working without the `kickoff` word
//   3. anything else → error, exit 1 (a typo is never a kickoff)
//
// `exists` is injectable so tests hit this directly without a store on disk —
// production passes nothing and reads planDir/doneDir live.
export function classifyMemArg(
  arg: string,
  exists?: (name: string) => boolean,
): "subcommand" | "plan" | "unknown" {
  // hasOwn, not `in` or indexing — prototype props ("toString") are not
  // subcommands.
  if (Object.hasOwn(HELP, arg)) return "subcommand";
  if (arg.endsWith(".md") || arg.includes("/")) return "plan";
  const has =
    exists ??
    ((name: string): boolean => {
      const base = basename(name);
      const candidates = [name, base, `${name}.md`, `${base}.md`];
      return candidates.some(
        (c) => existsSync(join(planDir, c)) || existsSync(join(doneDir, c)),
      );
    });
  if (has(arg)) return "plan";
  return "unknown";
}

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
  } else if (cmd === undefined) {
    // bare `fapony mem` → kickoff (ranked session overview)
    cmdKickoff(rest);
  } else if (classifyMemArg(cmd) === "plan") {
    // `fapony mem PLAN-x.md` — the plan arg rides along (the old else-branch
    // dropped it and printed the no-arg overview instead).
    cmdKickoff([cmd, ...rest]);
  } else {
    console.error(`fapony mem: unknown subcommand "${cmd}"`);
    const scored = MEM_SUBCOMMANDS.map((s) => ({
      s,
      d: levenshtein(cmd, s),
    }))
      .filter((x) => x.d <= 2)
      .sort((x, y) => x.d - y.d || (x.s < y.s ? -1 : 1))
      .slice(0, 3)
      .map((x) => `"fapony mem ${x.s}"`);
    if (scored.length > 0) {
      console.error(`did you mean ${scored.join(" or ")}?`);
    }
    console.error(`subcommands: ${MEM_SUBCOMMANDS.join(" ")}`);
    process.exit(1);
  }
}
