// src/install/opencode.ts — OpenCode install provider
//
// Adds mcp.fapony config to ~/.config/opencode/opencode.json or opencode.jsonc.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { claudeSkillsDir, linkSkills, reportSkills } from "./skills.js";
import {
  defaultExit,
  INSTALL_ROOT,
  type InstallDeps,
  MCP_CONFIG,
  MCP_KEY,
} from "./types.js";
import { computeDiff } from "./utils.js";

export function findOpencodeConfig(getHome: () => string): string | null {
  const dir = join(getHome(), ".config", "opencode");
  for (const name of ["opencode.json", "opencode.jsonc"]) {
    const p = join(dir, name);
    if (existsSync(p)) return p;
  }
  return null;
}

function stripJsonc(input: string): string {
  let out = "";
  let i = 0;
  while (i < input.length) {
    const c = input[i];
    if (c === "/" && input[i + 1] === "/") {
      while (i < input.length && input[i] !== "\n") i++;
      continue;
    }
    if (c === "/" && input[i + 1] === "*") {
      i += 2;
      while (i < input.length && !(input[i] === "*" && input[i + 1] === "/"))
        i++;
      i += 2;
      continue;
    }
    if (c === '"' || c === "'") {
      const quote = c;
      out += c;
      i++;
      while (i < input.length && input[i] !== quote) {
        if (input[i] === "\\") {
          out += input[i];
          i++;
        }
        if (i < input.length) {
          out += input[i];
          i++;
        }
      }
      if (i < input.length) {
        out += input[i];
        i++;
      }
      continue;
    }
    out += c;
    i++;
  }
  return out;
}

function parseJsonc(text: string): Record<string, unknown> {
  return JSON.parse(stripJsonc(text)) as Record<string, unknown>;
}

function isConfigured(mcp: Record<string, unknown> | undefined): boolean {
  if (!mcp) return false;
  const entry = mcp[MCP_KEY];
  if (!entry || typeof entry !== "object") return false;
  const cfg = entry as Record<string, unknown>;
  return (
    cfg.type === MCP_CONFIG.type &&
    JSON.stringify(cfg.command) === JSON.stringify(MCP_CONFIG.command)
  );
}

export function cmdInstallOpencode(
  dryRun: boolean,
  deps: InstallDeps = {},
): void {
  const exitFn = deps.exit ?? defaultExit;
  const getHome = deps.homedir ?? homedir;

  const configPath = findOpencodeConfig(getHome);
  let before: Record<string, unknown>;
  let isNew = false;

  if (configPath) {
    try {
      before = parseJsonc(readFileSync(configPath, "utf-8"));
    } catch (e) {
      console.error(`failed to parse ${configPath}: ${(e as Error).message}`);
      exitFn(1);
      return;
    }
  } else {
    isNew = true;
    before = {};
  }

  const mcp = (before.mcp as Record<string, unknown>) ?? {};
  if (isConfigured(mcp)) {
    console.error(`✓ mcp.${MCP_KEY} already configured — no change needed`);
    if (configPath) console.error(`  (${configPath})`);
    const skillsDir = claudeSkillsDir(getHome);
    reportSkills(linkSkills(skillsDir, dryRun), skillsDir, dryRun);
    installReadHintPlugin(dryRun, getHome);
    return;
  }

  const after = {
    ...before,
    mcp: {
      ...mcp,
      [MCP_KEY]: MCP_CONFIG,
    },
  };

  if (dryRun) {
    console.error(`── dry-run: would write mcp.${MCP_KEY} ──`);
    if (isNew) {
      console.error(
        `  (new file: ${join(getHome(), ".config", "opencode", "opencode.json")})`,
      );
    } else {
      console.error(`  (${configPath})`);
    }
    console.log(computeDiff(before, after));
    installReadHintPlugin(dryRun, getHome);
    return;
  }

  const targetPath =
    configPath ?? join(getHome(), ".config", "opencode", "opencode.json");
  const dir = targetPath.split("/").slice(0, -1).join("/");
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }

  writeFileSync(targetPath, `${JSON.stringify(after, null, 2)}\n`);
  if (isNew) {
    console.error(`✓ created ${targetPath} with mcp.${MCP_KEY}`);
  } else {
    console.error(`✓ added mcp.${MCP_KEY} to ${configPath}`);
  }
  console.error(`  restart opencode to load the MCP server`);
  const skillsDir = claudeSkillsDir(getHome);
  reportSkills(linkSkills(skillsDir, dryRun), skillsDir, dryRun);
  installReadHintPlugin(dryRun, getHome);
}

/**
 * OpenCode plugin — the read hint's in-process shape. `tool.execute.after`
 * receives `input.args` (the read call's own args) and a mutable
 * `output.output` string, so one hook computes and appends the hint with no
 * process spawn per Read. Annotate only: the hook mutates output, never
 * throws, never dedupes ("you already read this" goes false after context
 * compaction — a hook that guesses wrong must never trap the agent).
 *
 * Logic lives in src/hook.ts (readHintFor) — the plugin imports it from the
 * install root (path baked at install time), same one-copy-per-client shape
 * as the skills symlinks: a git pull in INSTALL_ROOT updates every client.
 * Best-effort, same policy as the claude hooks: an existing file that isn't
 * fapony's is never overwritten, and a failure never fails the install.
 */
export function readHintPluginSource(root: string): string {
  const hookModule = JSON.stringify(join(root, "src", "hook.ts"));
  return `// fapony read hint — annotates full-file reads of large source files with a
// factual review-seed pointer. Annotate only: never blocks, never dedupes.
// Generated by \`fapony install\` — edit src/hook.ts in the fapony checkout.
import { readHintFor } from ${hookModule};

export const FaponyReadHint = async ({ directory }) => {
  return {
    "tool.execute.after": async (input, output) => {
      try {
        if (input.tool !== "read") return;
        const hint = readHintFor({
          filePath: input.args?.filePath,
          offset: input.args?.offset,
          limit: input.args?.limit,
          cwd: directory,
        });
        if (hint && typeof output.output === "string") {
          output.output = output.output + "\\n" + hint;
        }
      } catch {
        // a hint must never break a read
      }
    },
  };
};
`;
}

function installReadHintPlugin(dryRun: boolean, getHome: () => string): void {
  const pluginsDir = join(getHome(), ".config", "opencode", "plugins");
  const pluginPath = join(pluginsDir, "fapony-read-hint.ts");
  if (existsSync(pluginPath)) {
    let current = "";
    try {
      current = readFileSync(pluginPath, "utf-8");
    } catch {
      current = "";
    }
    if (current.includes("readHintFor")) {
      console.error(`  read hint: already installed — no change`);
      return;
    }
    console.error(
      `  read hint: ${pluginPath} exists but isn't fapony's — not overwriting.`,
    );
    return;
  }
  if (!dryRun) {
    try {
      mkdirSync(pluginsDir, { recursive: true });
      writeFileSync(pluginPath, readHintPluginSource(INSTALL_ROOT), "utf-8");
    } catch (e) {
      console.error(`  read hint: failed to write — ${(e as Error).message}`);
      return;
    }
  }
  console.error(
    `  read hint: ${dryRun ? "would write" : "wrote"} ${pluginPath}`,
  );
}
