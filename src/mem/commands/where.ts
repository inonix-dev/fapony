// src/mem/commands/where.ts — `fapony mem where`: show which mem dir is resolved and how

import { whereMemDir } from "../../memory.js";

const USAGE = "usage: fapony mem where [--from <dir>]";

export function cmdWhere(args: string[]): void {
  let fromDir: string | undefined;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--from") {
      const v = args[i + 1];
      if (!v || v.startsWith("--")) {
        console.error(`fapony mem where: --from needs a value\n${USAGE}`);
        process.exit(1);
      }
      fromDir = v;
      i++;
    } else if (args[i] === "-h" || args[i] === "--help") {
      console.log(USAGE);
      return;
    }
  }

  const result = whereMemDir(fromDir);

  if (!result.dir) {
    console.log(
      `fapony mem where — no .fapony/.memory/ found (step: ${result.step})`,
    );
    console.log("  Create one with: fapony init <path>");
    return;
  }

  const labels: Record<string, string> = {
    flag: "--mem-dir flag",
    config: "paths.memDir in fapony.config.json",
    "walk-up": "walked up from cwd",
    "repo-root": "git repo root fallback",
    none: "not found",
  };

  console.log(`fapony mem where`);
  console.log(`  dir:   ${result.dir}`);
  console.log(`  step:  ${labels[result.step] ?? result.step}`);
}
