// src/install/codex.ts — Codex install provider
//
// Reads/writes ~/.codex/config.toml directly. Codex has no CLI for MCP config.

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { CODEX_MCP_ENTRY, defaultExit, type InstallDeps } from "./types.js";

export function findCodexConfig(getHome: () => string): string | null {
  const p = join(getHome(), ".codex", "config.toml");
  return existsSync(p) ? p : null;
}

function isCodexConfigured(content: string): boolean {
  // Check if [mcp_servers.fapony] section exists with our command
  const sectionRegex = /\[mcp_servers\.fapony\]/;
  if (!sectionRegex.test(content)) return false;
  // Verify it points to fapony
  return content.includes("fapony.ts") && content.includes("mcp");
}

export function cmdInstallCodex(dryRun: boolean, deps: InstallDeps = {}): void {
  const exitFn = deps.exit ?? defaultExit;
  const configPath = findCodexConfig(deps.homedir ?? homedir);

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
    return;
  }

  if (dryRun) {
    console.error(`── dry-run: would append to ${configPath} ──`);
    console.log(CODEX_MCP_ENTRY);
    return;
  }

  // Append the fapony MCP server entry to the end of the config file
  const newContent = `${content.trimEnd()}\n\n${CODEX_MCP_ENTRY}`;
  writeFileSync(configPath, newContent);
  console.error(`✓ added mcp_servers.fapony to ${configPath}`);
  console.error(`  restart Codex to load the MCP server`);
}
