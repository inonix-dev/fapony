// src/install/cursor.ts — Cursor install provider
//
// Writes mcpServers.fapony to ~/.cursor/mcp.json directly (Cursor has no CLI
// for MCP config) and appends the fapony stop hook to the stop array in
// ~/.cursor/hooks.json — append, never replace: other tools (e.g.
// code-review-graph) register hooks in the same file and Cursor runs every
// entry in the array.

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import {
  CURSOR_MCP_ENTRY,
  defaultExit,
  INSTALL_ROOT,
  type InstallDeps,
  MCP_KEY,
} from "./types.js";

/** ~/.cursor itself — the app creates it on first run, often before the user
 *  ever adds an MCP server or hook, so dir-exists is the detect signal. */
export function findCursorDir(getHome: () => string): string | null {
  const dir = join(getHome(), ".cursor");
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

export function cmdInstallCursor(
  dryRun: boolean,
  deps: InstallDeps = {},
): void {
  const exitFn = deps.exit ?? defaultExit;
  const getHome = deps.homedir ?? homedir;
  const cursorDir = findCursorDir(getHome);

  if (!cursorDir) {
    console.error(
      `Cursor not found — open Cursor at least once to create ~/.cursor`,
    );
    exitFn(1);
    return;
  }

  // --- 1. MCP server (mcpServers.fapony in ~/.cursor/mcp.json) ---
  const mcpPath = join(cursorDir, "mcp.json");
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
      console.error(`  restart Cursor to load the MCP server`);
    }
  }

  // --- 2. Stop hook (hooks.stop array in ~/.cursor/hooks.json) ---
  installStopHook(dryRun, cursorDir);
}

/**
 * Append `fapony hook-stop` to the stop array in ~/.cursor/hooks.json.
 * Same policy as Claude's installStopHook: never touch a hook someone else
 * registered, never fail the install over it. User hooks run from ~/.cursor/,
 * so the command must be an absolute path.
 */
function installStopHook(dryRun: boolean, cursorDir: string): void {
  const hooksPath = join(cursorDir, "hooks.json");
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
  const stop = Array.isArray(map.stop) ? (map.stop as unknown[]) : [];
  if (JSON.stringify(stop).includes("hook-stop")) {
    console.error(`  stop hook: already configured in hooks.json — no change`);
    return;
  }

  const command = `bun ${join(INSTALL_ROOT, "fapony.ts")} hook-stop`;
  const after = {
    ...config,
    version: typeof config.version === "number" ? config.version : 1,
    hooks: { ...map, stop: [...stop, { command }] },
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
    `  stop hook: ${dryRun ? "would write" : "wrote"} hooks.stop → ${hooksPath}`,
  );
}
