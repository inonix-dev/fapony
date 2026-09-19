// src/init-mem.ts — cleanup old .memory/ directories and warn about stale call sites.
//
// Before PLAN-agent-one-call, this file scaffolded templates/mem/ into every repo.
// Now fapony owns the mem code (src/mem/) and calls it directly via `fapony mem`.
// This command's new job: delete legacy .memory/ dirs + warn about package.json refs.

import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
} from "node:fs";
import { join } from "node:path";
import { loadConfig } from "./db/index.js";

export function copyDir(src: string, dest: string): string[] {
  mkdirSync(dest, { recursive: true });
  const copied: string[] = [];
  for (const entry of readdirSync(src, { withFileTypes: true })) {
    const s = join(src, entry.name);
    const d = join(dest, entry.name);
    if (entry.isDirectory()) {
      copied.push(...copyDir(s, d));
    } else {
      copyFileSync(s, d);
      copied.push(d);
    }
  }
  return copied;
}

export function cmdInitMem(args: string[]): void {
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
  const memoryDirs: string[] = [];
  const walk = (dir: string, depth = 0) => {
    if (depth > 4) return;
    if (existsSync(`${dir}/.memory`)) {
      memoryDirs.push(`${dir}/.memory`);
    }
    try {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        if (
          entry.isDirectory() &&
          !entry.name.startsWith(".") &&
          entry.name !== "node_modules"
        ) {
          walk(join(dir, entry.name), depth + 1);
        }
      }
    } catch {
      // ignore
    }
  };
  walk(root);

  if (memoryDirs.length === 0) {
    console.log("no legacy .memory/ directories found — already clean");
  } else {
    for (const d of memoryDirs) {
      const hasLog = existsSync(`${d}/log.jsonl`);
      console.log(`deleting ${d}${hasLog ? " (contains log.jsonl!)" : ""}`);
      rmSync(d, { recursive: true, force: true });
    }
    console.log(
      `\nremoved ${memoryDirs.length} legacy .memory/ director${memoryDirs.length === 1 ? "y" : "ies"}`,
    );
  }

  // 2) Warn about package.json call sites still referencing .memory/mem.ts
  const warnAboutCallSites = (dir: string, depth = 0) => {
    if (depth > 4) return;
    const pkg = join(dir, "package.json");
    if (existsSync(pkg)) {
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
    try {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        if (
          entry.isDirectory() &&
          !entry.name.startsWith(".") &&
          entry.name !== "node_modules"
        ) {
          warnAboutCallSites(join(dir, entry.name), depth + 1);
        }
      }
    } catch {
      // ignore
    }
  };
  warnAboutCallSites(root);

  console.log("\nmem commands are now built into fapony:");
  console.log('  fapony mem add <kind> "<text>" --files <files>');
  console.log('  fapony mem close <id> "<text>"');
  console.log("  fapony mem find <word>");
  console.log("  fapony mem kickoff [id|spec.md]");
  console.log("  fapony mem now");
}
