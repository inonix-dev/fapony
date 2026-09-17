// src/stats/cli.ts — cmdStats CLI entry point

import { execFileSync } from "node:child_process";
import { getStatsData } from "./data.js";
import { formatStatsText, formatVerdictText } from "./format.js";

/** Absolute path of the repo/worktree the CLI was run in, or null outside git. */
function currentWorktree(): string | null {
  try {
    return execFileSync("git", ["rev-parse", "--show-toplevel"], {
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
    }).trim();
  } catch {
    return null;
  }
}

export function cmdStats(args: string[]): void {
  // Default to the project you are standing in. Averaging several projects
  // together reads as "in this project" while being no such thing, so going
  // global is opt-in and the header always says which one you got.
  const worktree = args.includes("--all")
    ? undefined
    : (currentWorktree() ?? undefined);
  const data = getStatsData(worktree);

  const modeIdx = args.indexOf("--mode");
  const mode =
    modeIdx !== -1 && typeof args[modeIdx + 1] === "string"
      ? args[modeIdx + 1]
      : undefined;

  if (mode === "verdict") {
    const regimeIdx = args.indexOf("--regime");
    const regime =
      regimeIdx !== -1 && typeof args[regimeIdx + 1] === "string"
        ? args[regimeIdx + 1]
        : undefined;
    console.log(formatVerdictText(data, regime));
  } else {
    console.log(formatStatsText(data));
  }
}
