// src/install/zcode.ts — ZCode install provider
//
// Symlinks skills into ~/.agents/skills/. Memory moved to fael.

import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { agentsSkillsDir, linkSkills, reportSkills } from "./skills.js";
import { defaultExit, type InstallDeps } from "./types.js";

/** Resolve the active ZCode config file. Primary: ~/.zcode/cli/config.json.
 *  Fallback: ~/.agents/mcp.json (only when primary is absent). */
export function findZcodeConfig(
  getHome: () => string,
): { path: string; key: "mcp.servers" | "mcpServers" } | null {
  const primary = join(getHome(), ".zcode", "cli", "config.json");
  if (existsSync(primary)) return { path: primary, key: "mcp.servers" };
  const fallback = join(getHome(), ".agents", "mcp.json");
  if (existsSync(fallback)) return { path: fallback, key: "mcpServers" };
  return null;
}

export function cmdInstallZcode(dryRun: boolean, deps: InstallDeps = {}): void {
  const getHome = deps.homedir ?? homedir;
  if (!findZcodeConfig(getHome)) {
    console.error(
      `ZCode config not found — open ZCode at least once to create ~/.zcode/cli/config.json`,
    );
    (deps.exit ?? defaultExit)(1);
    return;
  }
  const skillsDir = agentsSkillsDir(getHome);
  reportSkills(linkSkills(skillsDir, dryRun), skillsDir, dryRun);
}
