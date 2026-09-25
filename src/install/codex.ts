// src/install/codex.ts — Codex install provider
//
// Symlinks skills into ~/.agents/skills/ (same dir as ZCode). Memory (MCP,
// Stop, SessionStart) moved to fael — `fael install` wires it.

import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { agentsSkillsDir, linkSkills, reportSkills } from "./skills.js";
import { defaultExit, type InstallDeps } from "./types.js";

export function findCodexConfig(getHome: () => string): string | null {
  const p = join(getHome(), ".codex", "config.toml");
  return existsSync(p) ? p : null;
}

export function cmdInstallCodex(dryRun: boolean, deps: InstallDeps = {}): void {
  const getHome = deps.homedir ?? homedir;
  if (!findCodexConfig(getHome)) {
    console.error(
      `Codex config not found — open Codex at least once to create ~/.codex/config.toml`,
    );
    (deps.exit ?? defaultExit)(1);
    return;
  }
  const skillsDir = agentsSkillsDir(getHome);
  reportSkills(linkSkills(skillsDir, dryRun), skillsDir, dryRun);
}
