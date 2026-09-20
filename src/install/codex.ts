// src/install/codex.ts — Codex install provider
//
// Reads/writes ~/.codex/config.toml directly for MCP config.
// Reads/writes ~/.codex/hooks.json for lifecycle hooks (Stop).
// Symlinks skills into ~/.agents/skills/ (same dir as ZCode).

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { agentsSkillsDir, linkSkills, reportSkills } from "./skills.js";
import {
  CODEX_MCP_ENTRY,
  defaultExit,
  INSTALL_ROOT,
  type InstallDeps,
} from "./types.js";

export function findCodexConfig(getHome: () => string): string | null {
  const p = join(getHome(), ".codex", "config.toml");
  return existsSync(p) ? p : null;
}

export function findCodexHooksJson(getHome: () => string): string | null {
  const p = join(getHome(), ".codex", "hooks.json");
  return existsSync(p) ? p : null;
}

function isCodexConfigured(content: string): boolean {
  // Check if [mcp_servers.fapony] section exists with our command
  const sectionRegex = /\[mcp_servers\.fapony\]/;
  if (!sectionRegex.test(content)) return false;
  // Verify it points to fapony
  return content.includes("fapony.ts") && content.includes("mcp");
}

function readJsonObject(path: string): Record<string, unknown> | null {
  try {
    const parsed: unknown = JSON.parse(readFileSync(path, "utf-8"));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return null;
    }
    return parsed as Record<string, unknown>;
  } catch {
    return null;
  }
}

/**
 * Append the fapony Stop hook to ~/.codex/hooks.json.
 * Never replaces other hook groups or foreign entries within the Stop group.
 * Fapony-owned entry is identified by the command string containing "hook-stop".
 */
function installStopHook(dryRun: boolean, getHome: () => string): void {
  const hooksPath = join(getHome(), ".codex", "hooks.json");
  let config: Record<string, unknown> = {};
  if (existsSync(hooksPath)) {
    const parsed = readJsonObject(hooksPath);
    if (!parsed) {
      console.error(
        `  stop hook: ${hooksPath} is unreadable or malformed — skipping`,
      );
      return;
    }
    config = parsed;
  }

  const hookMap = config.hooks;
  if (
    hookMap !== undefined &&
    (typeof hookMap !== "object" || Array.isArray(hookMap))
  ) {
    console.error(
      `  stop hook: ${hooksPath} has an unexpected "hooks" shape — skipping`,
    );
    return;
  }

  const map = (hookMap ?? {}) as Record<string, unknown>;
  // Codex Stop array: each element is { matcher?, hooks: [...] }
  const stop = Array.isArray(map.Stop) ? (map.Stop as unknown[]) : [];

  // Check if fapony stop hook already present (by command string)
  const serialized = JSON.stringify(stop);
  if (serialized.includes("hook-stop")) {
    console.error(`  stop hook: already configured in hooks.json — no change`);
    return;
  }

  const command = `bun ${join(INSTALL_ROOT, "fapony.ts")} hook-stop`;
  const faponyEntry = { hooks: [{ type: "command", command }] };
  const after = {
    ...config,
    hooks: { ...map, Stop: [...stop, faponyEntry] },
  };

  if (!dryRun) {
    try {
      writeFileSync(hooksPath, `${JSON.stringify(after, null, 2)}\n`, "utf-8");
    } catch (e) {
      console.error(`  stop hook: failed to write — ${(e as Error).message}`);
      return;
    }
  }
  console.error(
    `  stop hook: ${dryRun ? "would write" : "wrote"} hooks.Stop → ${hooksPath}`,
  );
  console.error(
    `    review and trust via Codex /hooks before the hook will run`,
  );
}

export function cmdInstallCodex(dryRun: boolean, deps: InstallDeps = {}): void {
  const exitFn = deps.exit ?? defaultExit;
  const getHome = deps.homedir ?? homedir;
  const configPath = findCodexConfig(getHome);

  if (!configPath) {
    console.error(
      `Codex config not found — open Codex at least once to create ~/.codex/config.toml`,
    );
    exitFn(1);
    return;
  }

  let content: string;
  try {
    content = readFileSync(configPath, "utf-8");
  } catch (e) {
    console.error(`failed to read ${configPath}: ${(e as Error).message}`);
    exitFn(1);
    return;
  }

  if (isCodexConfigured(content)) {
    console.error(`✓ mcp_servers.fapony already configured — no change needed`);
    console.error(`  (${configPath})`);
  } else if (dryRun) {
    console.error(`── dry-run: would append to ${configPath} ──`);
    console.log(CODEX_MCP_ENTRY);
  } else {
    const newContent = `${content.trimEnd()}\n\n${CODEX_MCP_ENTRY}`;
    writeFileSync(configPath, newContent);
    console.error(`✓ added mcp_servers.fapony to ${configPath}`);
    console.error(`  restart Codex to load the MCP server`);
  }

  // --- Stop hook (~/.codex/hooks.json) ---
  installStopHook(dryRun, getHome);

  // --- Skills (~/.agents/skills/) ---
  const skillsDir = agentsSkillsDir(getHome);
  reportSkills(linkSkills(skillsDir, dryRun), skillsDir, dryRun);
}
