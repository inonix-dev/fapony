// src/install/antigravity.ts — Google Antigravity install provider
//
// Symlinks skills into ~/.agents/skills/ (Progressive Skills path). Memory
// moved to fael.

import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { defaultCheckCmd } from "../setup.js";
import { agentsSkillsDir, linkSkills, reportSkills } from "./skills.js";
import { defaultExit, type InstallDeps } from "./types.js";

/** ~/.gemini — created on first Antigravity launch. */
export function findGeminiDir(getHome: () => string): string | null {
  const dir = join(getHome(), ".gemini");
  return existsSync(dir) ? dir : null;
}

export function cmdInstallAntigravity(
  dryRun: boolean,
  deps: InstallDeps = {},
): void {
  const getHome = deps.homedir ?? homedir;
  const checkCmd = deps.checkCmd ?? defaultCheckCmd;
  if (!findGeminiDir(getHome) && !checkCmd("agy")) {
    console.error(
      `Antigravity not found — open Antigravity at least once to create ~/.gemini (or put the agy CLI on PATH)`,
    );
    (deps.exit ?? defaultExit)(1);
    return;
  }
  const skillsDir = agentsSkillsDir(getHome);
  reportSkills(linkSkills(skillsDir, dryRun), skillsDir, dryRun);
}
