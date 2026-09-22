// src/init-mem.ts — cleanup old .memory/ directories and warn about stale call sites.
//
// Before PLAN-agent-one-call, this file scaffolded templates/mem/ into every repo.
// Now fapony owns the mem code (src/mem/) and calls it directly via `fapony mem`.
// This command's new job: delete legacy .memory/ dirs + warn about package.json refs.

import { existsSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { DEFAULT_MEM_DIR, FAPONY_DIR, loadConfig } from "./core/config.js";
import { walkDir } from "./util.js";

export function cmdInitMem(args: string[]): void {
  const force = args.includes("--force");
  const worktreeKey = args.find((x) => !x.startsWith("-"));
  const config = loadConfig();

  // no key given = the repo you are standing in
  const worktree = worktreeKey ? config.worktrees[worktreeKey] : process.cwd();
  if (!worktree) {
    console.error(`unknown worktree key: ${worktreeKey}`);
    console.error(`available: ${Object.keys(config.worktrees).join(", ")}`);
    process.exit(1);
  }

  const gitRoot = Bun.spawnSync(["git", "rev-parse", "--show-toplevel"], {
    cwd: worktree,
  })
    .stdout.toString()
    .trim();
  const root = gitRoot || worktree;

  // 1) Find and delete .memory/ directories (legacy layout)
  const memoryDirs = walkDir(root, {
    includeDotDirs: [FAPONY_DIR],
    predicate: (dir) => existsSync(join(dir, ".memory")),
  }).map((dir) => join(dir, ".memory"));

  // Legacy filenames that may live alongside live logs inside .fapony/.memory/
  const LEGACY_MEM_FILENAMES = [
    "mem.ts",
    "store.ts",
    "selectors.ts",
    "render.ts",
  ];

  if (memoryDirs.length === 0) {
    console.log("no legacy .memory/ directories found — already clean");
  } else {
    let removed = 0;
    let kept = 0;
    for (const d of memoryDirs) {
      // Any log*.jsonl is history — includes log.<person>.jsonl (the standard
      // filename) and rotated log.YYYY-MM-DD.jsonl, not just log.jsonl.
      let logs: string[] = [];
      try {
        logs = readdirSync(d).filter(
          (f) => f === "log.jsonl" || /^log\..*\.jsonl$/.test(f),
        );
      } catch {
        // unreadable dir — fall through and remove
      }
      // Inside .fapony/.memory/: remove known legacy .ts files while keeping
      // live logs. The keep-if-logs guard would preserve the whole directory,
      // but legacy scaffolding (mem.ts, store.ts, ...) is dead code that
      // should not linger beside the active log.
      const isFaponyMemory =
        d.endsWith(`/${FAPONY_DIR}/.memory`) || d === `${FAPONY_DIR}/.memory`;
      if (isFaponyMemory && logs.length > 0) {
        let legacyRemoved = 0;
        let commandsRemoved = 0;
        for (const name of LEGACY_MEM_FILENAMES) {
          const fp = join(d, name);
          if (existsSync(fp)) {
            rmSync(fp);
            legacyRemoved++;
          }
        }
        const commandsDir = join(d, "commands");
        if (existsSync(commandsDir)) {
          rmSync(commandsDir, { recursive: true, force: true });
          commandsRemoved++;
        }
        if (legacyRemoved || commandsRemoved) {
          console.log(
            `cleaned ${d} — removed ${legacyRemoved} legacy file(s)${
              commandsRemoved ? " + commands/" : ""
            } (kept ${logs.length} log file(s): ${logs.join(", ")})`,
          );
        } else {
          console.log(`${d} — already clean (logs: ${logs.join(", ")})`);
        }
        kept++;
        continue;
      }
      if (logs.length > 0 && !force) {
        console.log(
          `keeping ${d} — has ${logs.length} log file(s): ${logs.join(", ")}`,
        );
        console.log(
          `  move them under ${DEFAULT_MEM_DIR}/, or re-run with --force to delete`,
        );
        kept++;
        continue;
      }
      console.log(
        `deleting ${d}${logs.length > 0 ? ` (--force: ${logs.length} log file(s))` : ""}`,
      );
      rmSync(d, { recursive: true, force: true });
      removed++;
    }
    console.log(
      `\nremoved ${removed} legacy .memory/ director${removed === 1 ? "y" : "ies"}${
        kept > 0
          ? ` · kept ${kept} with logs — move them under ${DEFAULT_MEM_DIR}/, then re-run`
          : ""
      }`,
    );
  }

  // 2) Warn about package.json call sites still referencing .memory/mem.ts
  for (const dir of walkDir(root)) {
    const pkg = join(dir, "package.json");
    if (!existsSync(pkg)) continue;
    try {
      const raw = readFileSync(pkg, "utf8");
      if (raw.includes(".memory/mem.ts")) {
        console.log(`\n⚠ ${pkg} still references .memory/mem.ts`);
        console.log(
          `  update to: "fapony mem <sub>" (e.g. "fapony mem add", "fapony mem close")`,
        );
      }
    } catch {
      // ignore
    }
  }

  console.log("\nmem commands are now built into fapony:");
  console.log('  fapony mem add <kind> "<text>" --files <files>');
  console.log('  fapony mem close <id> "<text>"');
  console.log("  fapony mem find <word>");
  console.log("  fapony mem kickoff [id|spec.md]");
  console.log("  fapony mem done | stale");
}
