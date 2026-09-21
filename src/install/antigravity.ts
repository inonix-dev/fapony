// src/install/antigravity.ts — Google Antigravity install provider
//
// Writes mcpServers.fapony to ~/.gemini/config/mcp_config.json (Antigravity's
// global MCP config) and symlinks skills into ~/.agents/skills/ (Progressive
// Skills path). No hooks in the first phase — Antigravity's hook surface is
// still evolving.

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { agentsSkillsDir, linkSkills, reportSkills } from "./skills.js";
import {
  CURSOR_MCP_ENTRY,
  defaultExit,
  type InstallDeps,
  MCP_KEY,
} from "./types.js";

/** ~/.gemini — created on first Antigravity launch. */
export function findGeminiDir(getHome: () => string): string | null {
  const dir = join(getHome(), ".gemini");
  return existsSync(dir) ? dir : null;
}

function isFaponyEntry(entry: unknown): boolean {
  if (!entry || typeof entry !== "object") return false;
  const cfg = entry as Record<string, unknown>;
  return (
    cfg.command === CURSOR_MCP_ENTRY.command &&
    JSON.stringify(cfg.args) === JSON.stringify(CURSOR_MCP_ENTRY.args)
  );
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

export function cmdInstallAntigravity(
  dryRun: boolean,
  deps: InstallDeps = {},
): void {
  const exitFn = deps.exit ?? defaultExit;
  const getHome = deps.homedir ?? homedir;
  const geminiDir = findGeminiDir(getHome);

  if (!geminiDir) {
    console.error(
      `Antigravity not found — open Antigravity at least once to create ~/.gemini`,
    );
    exitFn(1);
    return;
  }

  // --- 1. MCP server (mcpServers.fapony in ~/.gemini/config/mcp_config.json) ---
  const configDir = join(geminiDir, "config");
  const mcpPath = join(configDir, "mcp_config.json");
  let mcp: Record<string, unknown> = {};
  let mcpIsNew = true;
  if (existsSync(mcpPath)) {
    const parsed = readJsonObject(mcpPath);
    if (!parsed) {
      console.error(`failed to parse ${mcpPath} — fix or remove it first`);
      exitFn(1);
      return;
    }
    mcp = parsed;
    mcpIsNew = false;
  }
  const servers = (mcp.mcpServers ?? {}) as Record<string, unknown>;
  const existing = servers[MCP_KEY];
  if (existing !== undefined && !isFaponyEntry(existing)) {
    console.error(
      `an MCP server named "${MCP_KEY}" exists but points elsewhere — not overwriting.`,
    );
    console.error(`  inspect ${mcpPath} and remove it first`);
    exitFn(1);
    return;
  }
  if (existing !== undefined) {
    console.error(
      `✓ mcpServers.${MCP_KEY} already configured — no change needed`,
    );
    console.error(`  (${mcpPath})`);
  } else {
    const after = {
      ...mcp,
      mcpServers: { ...servers, [MCP_KEY]: CURSOR_MCP_ENTRY },
    };
    if (dryRun) {
      console.error(
        `── dry-run: would ${mcpIsNew ? "create" : "write"} ${mcpPath}${mcpIsNew ? "" : ` (mcpServers.${MCP_KEY})`} ──`,
      );
    } else {
      writeFileSync(mcpPath, `${JSON.stringify(after, null, 2)}\n`, "utf-8");
      console.error(`✓ added mcpServers.${MCP_KEY} to ${mcpPath}`);
      console.error(`  restart Antigravity to load the MCP server`);
    }
  }

  // --- 2. Skills (~/.agents/skills/) ---
  const skillsDir = agentsSkillsDir(getHome);
  const results = linkSkills(skillsDir, dryRun);
  reportSkills(results, skillsDir, dryRun);
}
