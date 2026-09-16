// src/install.ts — `fapony install --platform opencode|claude|cursor|zcode|codex` command.
// opencode: adds mcp.fapony config to ~/.config/opencode/opencode.json or opencode.jsonc.
// claude: shells out to `claude mcp add` (never parses/writes ~/.claude.json directly).
// cursor: writes mcpServers.fapony to ~/.cursor/mcp.json directly and merges the
//         fapony stop hook into the stop array in ~/.cursor/hooks.json.
// zcode: reads/writes ~/.zcode/cli/config.json (fallback ~/.agents/mcp.json) directly,
//        and symlinks skills into ~/.agents/skills.
// codex: reads/writes ~/.codex/config.toml directly.
// All platforms are idempotent + support --dry-run.
// Claude/OpenCode also get skill/<name>/ symlinked into ~/.claude/skills so
// `fapony update` reaches them without a second copy to keep in sync.
// ZCode gets skill/<name>/ symlinked into ~/.agents/skills.

import { createInterface } from "node:readline";
import { cmdInstallClaude } from "./install/claude.js";
import { cmdInstallCodex } from "./install/codex.js";
import { cmdInstallCursor } from "./install/cursor.js";
import { detectClients } from "./install/detect.js";
import { cmdInstallOpencode } from "./install/opencode.js";
import { defaultExit, type InstallDeps } from "./install/types.js";
import { cmdInstallZcode } from "./install/zcode.js";
import { ask } from "./setup.js";
import { isAffirmative } from "./util.js";

export {
  claudeAddArgs,
  claudeGetArgs,
  claudeGetPointsToFapony,
  cmdInstallClaude,
} from "./install/claude.js";
export {
  cmdInstallCodex,
  findCodexConfig,
} from "./install/codex.js";
export { cmdInstallCursor, findCursorDir } from "./install/cursor.js";
export { detectClients } from "./install/detect.js";
export {
  cmdInstallOpencode,
  findOpencodeConfig,
} from "./install/opencode.js";
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
export { cmdInstallZcode, findZcodeConfig } from "./install/zcode.js";
export { ask, defaultCheckCmd } from "./setup.js";

export async function cmdInstall(
  args: string[],
  deps: InstallDeps = {},
): Promise<void> {
  const platform = args.find((a) => !a.startsWith("--"));
  const dryRun = args.includes("--dry-run");
  const installAll = args.includes("--all");

  // --- explicit platform: original behavior, unchanged ---
  if (platform === "claude") {
    cmdInstallClaude(dryRun, deps);
    return;
  }
  if (platform === "cursor") {
    cmdInstallCursor(dryRun, deps);
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
  if (platform === "opencode") {
    cmdInstallOpencode(dryRun, deps);
    return;
  }
  if (platform !== undefined) {
    console.error(
      `usage: fapony install --platform opencode|claude|cursor|zcode|codex [--dry-run]`,
    );
    console.error(
      `  supported platforms: opencode, claude, cursor, zcode, codex`,
    );
    (deps.exit ?? defaultExit)(1);
    return;
  }

  // --- no platform: detect + prompt ---
  const detected = detectClients(deps);
  const found = detected.filter((d) => d.installed);
  const notFound = detected.filter((d) => !d.installed);

  const foundNames = found.map((d) => d.platform).join(", ");
  const notFoundNames = notFound.map((d) => d.platform).join(", ");
  console.error(
    `  detected: ${foundNames || "(none)"}${notFoundNames ? `        not found: ${notFoundNames}` : ""}`,
  );
  console.error(
    `  (not found = no config file yet — or, for claude, the CLI is not on PATH.`,
  );
  console.error(`   open the app once, or force with --platform <name>)`);

  if (found.length === 0) {
    console.error();
    console.error(
      `  no MCP client found (looked for claude on PATH; config files for cursor, opencode, zcode, codex).`,
    );
    console.error(
      `  open the app once, then re-run — or force with: fapony install --platform <name>`,
    );
    return;
  }

  // --all: install everything detected without prompting (works in CI/non-TTY).
  if (installAll) {
    console.error();
    for (const client of found) {
      installPlatform(client.platform, dryRun, deps);
    }
    return;
  }

  // Non-TTY without --all: print results + hint, don't install anything.
  if (!process.stdin.isTTY) {
    console.error();
    console.error(
      `  stdin is not a terminal — re-run with --all, or --platform <name>`,
    );
    return;
  }

  // Build the ask function: injected (tests) or real readline (production).
  // Mirrors cmdSetup's seam — one readline for the whole loop, closed after.
  const rl = deps.ask
    ? null
    : createInterface({ input: process.stdin, output: process.stdout });
  const askFn =
    deps.ask ??
    ((question: string, defaultVal?: string) => ask(rl!, question, defaultVal));

  // Prompt each detected client.
  try {
    console.error();
    for (const client of found) {
      const answer = await askFn(`install into ${client.platform}?`, "Y");
      if (isAffirmative(answer)) {
        installPlatform(client.platform, dryRun, deps);
      }
    }
  } finally {
    rl?.close();
  }
}

function installPlatform(
  platform: string,
  dryRun: boolean,
  deps: InstallDeps,
): void {
  switch (platform) {
    case "claude":
      cmdInstallClaude(dryRun, deps);
      break;
    case "cursor":
      cmdInstallCursor(dryRun, deps);
      break;
    case "opencode":
      cmdInstallOpencode(dryRun, deps);
      break;
    case "zcode":
      cmdInstallZcode(dryRun, deps);
      break;
    case "codex":
      cmdInstallCodex(dryRun, deps);
      break;
  }
}
