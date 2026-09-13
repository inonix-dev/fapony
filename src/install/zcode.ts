// src/install/zcode.ts — ZCode install provider
//
// Reads/writes ~/.zcode/cli/config.json (fallback ~/.agents/mcp.json) directly.
// ZCode has no `zcode mcp add` CLI.

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { agentsSkillsDir, linkSkills, reportSkills } from "./skills.js";
import {
  defaultExit,
  type InstallDeps,
  MCP_KEY,
  ZCODE_MCP_CONFIG,
} from "./types.js";
import { computeDiff } from "./utils.js";

/** Resolve the active ZCode config file. Primary: ~/.zcode/cli/config.json.
 *  Fallback: ~/.agents/mcp.json (only when primary is absent). */
function findZcodeConfig(
  getHome: () => string,
): { path: string; key: "mcp.servers" | "mcpServers" } | null {
  const primary = join(getHome(), ".zcode", "cli", "config.json");
  if (existsSync(primary)) return { path: primary, key: "mcp.servers" };
  const fallback = join(getHome(), ".agents", "mcp.json");
  if (existsSync(fallback)) return { path: fallback, key: "mcpServers" };
  return null;
}

function getZcodeServers(
  cfg: Record<string, unknown>,
  key: "mcp.servers" | "mcpServers",
): Record<string, unknown> | undefined {
  if (key === "mcpServers") {
    return cfg.mcpServers as Record<string, unknown> | undefined;
  }
  const mcp = cfg.mcp as Record<string, unknown> | undefined;
  return mcp?.servers as Record<string, unknown> | undefined;
}

function setZcodeServers(
  cfg: Record<string, unknown>,
  key: "mcp.servers" | "mcpServers",
  servers: Record<string, unknown>,
): Record<string, unknown> {
  if (key === "mcpServers") {
    return { ...cfg, mcpServers: servers };
  }
  const mcp = (cfg.mcp as Record<string, unknown>) ?? {};
  return { ...cfg, mcp: { ...mcp, servers } };
}

function isZcodeConfigured(
  servers: Record<string, unknown> | undefined,
): boolean {
  if (!servers) return false;
  const entry = servers[MCP_KEY];
  if (!entry || typeof entry !== "object") return false;
  const cfg = entry as Record<string, unknown>;
  if (cfg.type !== "stdio" && cfg.type !== undefined) return false;
  if (cfg.command !== ZCODE_MCP_CONFIG.command) return false;
  if (!Array.isArray(cfg.args)) return false;
  return JSON.stringify(cfg.args) === JSON.stringify(ZCODE_MCP_CONFIG.args);
}

export function cmdInstallZcode(dryRun: boolean, deps: InstallDeps = {}): void {
  const exitFn = deps.exit ?? defaultExit;
  const getHome = deps.homedir ?? homedir;

  const found = findZcodeConfig(getHome);
  if (!found) {
    console.error(
      `ZCode config not found — open ZCode at least once to create ~/.zcode/cli/config.json`,
    );
    exitFn(1);
    return;
  }

  let before: Record<string, unknown>;
  try {
    before = JSON.parse(readFileSync(found.path, "utf-8")) as Record<
      string,
      unknown
    >;
  } catch (e) {
    console.error(`failed to parse ${found.path}: ${(e as Error).message}`);
    exitFn(1);
    return;
  }

  const servers = getZcodeServers(before, found.key) ?? {};
  if (isZcodeConfigured(servers)) {
    console.error(`✓ mcp.${MCP_KEY} already configured — no change needed`);
    console.error(`  (${found.path})`);
    return;
  }

  const after = setZcodeServers(before, found.key, {
    ...servers,
    [MCP_KEY]: ZCODE_MCP_CONFIG,
  });

  if (dryRun) {
    console.error(`── dry-run: would write ${found.key}.${MCP_KEY} ──`);
    console.error(`  (${found.path})`);
    console.log(computeDiff(before, after));
    return;
  }

  writeFileSync(found.path, `${JSON.stringify(after, null, 2)}\n`);
  console.error(`✓ added mcp.${MCP_KEY} to ${found.path}`);
  if (found.key === "mcpServers") {
    console.error(`  (fallback path: ~/.agents/mcp.json)`);
  }
  console.error(`  restart ZCode to load the MCP server`);
  const skillsDir = agentsSkillsDir(getHome);
  reportSkills(linkSkills(skillsDir, dryRun), skillsDir, dryRun);
}
