// src/install.ts — `fapony install --platform opencode|claude|zcode|codex` command.
// opencode: adds mcp.fapony config to ~/.config/opencode/opencode.json or opencode.jsonc.
// claude: shells out to `claude mcp add` (never parses/writes ~/.claude.json directly).
// zcode: reads/writes ~/.zcode/cli/config.json (fallback ~/.agents/mcp.json) directly,
//        and symlinks skills into ~/.agents/skills.
// codex: reads/writes ~/.codex/config.toml directly.
// All platforms are idempotent + support --dry-run.
// Claude/OpenCode also get skill/<name>/ symlinked into ~/.claude/skills so
// `fapony update` reaches them without a second copy to keep in sync.
// ZCode gets skill/<name>/ symlinked into ~/.agents/skills.

import { cmdInstallClaude } from "./install/claude.js";
import { cmdInstallCodex } from "./install/codex.js";
import { cmdInstallOpencode } from "./install/opencode.js";
import { defaultExit, type InstallDeps } from "./install/types.js";
import { cmdInstallZcode } from "./install/zcode.js";

export {
  claudeAddArgs,
  claudeGetArgs,
  claudeGetPointsToFapony,
  cmdInstallClaude,
} from "./install/claude.js";
export { cmdInstallCodex } from "./install/codex.js";
export { cmdInstallOpencode } from "./install/opencode.js";
export {
  agentsSkillsDir,
  claudeSkillsDir,
  linkSkills,
} from "./install/skills.js";
export {
  type ClaudeRunResult,
  defaultExit,
  INSTALL_ROOT,
  type InstallDeps,
  type SkillLinkAction,
  type SkillLinkResult,
} from "./install/types.js";
export { cmdInstallZcode } from "./install/zcode.js";

export function cmdInstall(args: string[], deps: InstallDeps = {}): void {
  const platform = args.find((a) => !a.startsWith("--"));
  const dryRun = args.includes("--dry-run");

  if (platform === "claude") {
    cmdInstallClaude(dryRun, deps);
    return;
  }

  if (platform === "zcode") {
    cmdInstallZcode(dryRun, deps);
    return;
  }

  if (platform === "codex") {
    cmdInstallCodex(dryRun, deps);
    return;
  }

  if (platform !== "opencode") {
    console.error(
      `usage: fapony install --platform opencode|claude|zcode|codex [--dry-run]`,
    );
    console.error(`  supported platforms: opencode, claude, zcode, codex`);
    (deps.exit ?? defaultExit)(1);
    return;
  }

  cmdInstallOpencode(dryRun, deps);
}
