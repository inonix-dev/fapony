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
    installCommitHintPlugin(dryRun, getHome);
    installEditHintPlugin(dryRun, getHome);
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
    installCommitHintPlugin(dryRun, getHome);
    installEditHintPlugin(dryRun, getHome);
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
  installCommitHintPlugin(dryRun, getHome);
  installEditHintPlugin(dryRun, getHome);
}

/**
 * OpenCode plugin — the read hint's in-process shape. `tool.execute.after`
 * receives `input.args` (the read call's own args) and a mutable
 * `output.output` string, so one hook computes and appends the hint with no
 * process spawn per Read. Annotate only: the hook mutates output, never
 * throws, never dedupes ("you already read this" goes false after context
 * compaction — a hook that guesses wrong must never trap the agent).
 *
 * Logic lives in src/hook.ts (readHintFor + readContextLines) — the plugin
 * imports it from the install root (path baked at install time), same
 * one-copy-per-client shape as the skills symlinks: a git pull in
 * INSTALL_ROOT updates every client. Mirrors Claude's cmdHookReadHint
 * (PreToolUse), which appends both the size hint and the debt/mem context —
 * OpenCode was missing the second half until now (only the size hint was
 * wired), so a convention debt on the file you just opened, or a mem-log
 * row about it, never reached OpenCode even though the detector already
 * runs on every read. Best-effort, same policy as the claude hooks: an
 * existing file that isn't fapony's is never overwritten, and a failure
 * never fails the install.
 */
export function readHintPluginSource(root: string): string {
  const hookModule = JSON.stringify(join(root, "src", "hook.ts"));
  return `// fapony read hint — annotates full-file reads of large source files with a
// factual review-seed pointer, plus any convention debt or mem-log row about
// the file. Annotate only: never blocks, never dedupes.
// Generated by \`fapony install\` — edit src/hook.ts in the fapony checkout.
import { readHintFor, rereadHintFor, readContextData, recordHintFire } from ${hookModule};

export const FaponyReadHint = async ({ directory }) => {
  return {
    "tool.execute.after": async (input, output) => {
      try {
        if (input.tool !== "read") return;
        const filePath = input.args?.filePath;
        const parts = [];
        const hint = readHintFor({
          filePath,
          offset: input.args?.offset,
          limit: input.args?.limit,
          cwd: directory,
        });
        if (hint) parts.push(hint);
        const reread = rereadHintFor({
          filePath,
          offset: input.args?.offset,
          limit: input.args?.limit,
          cwd: directory,
          session: input.sessionID,
        });
        if (reread) parts.push(reread);
        const ctx = readContextData(filePath, directory);
        if (ctx) {
          for (const line of [...ctx.debtLines, ...ctx.memLines]) {
            parts.push(line);
          }
        }
        if (parts.length > 0 && typeof output.output === "string") {
          output.output = output.output + "\\n" + parts.join("\\n");
        }

        // --- hint-fire log (PLAN-feedback-surface chunk 1) ---
        // After output — best-effort, never block the hint.
        if (ctx?.worktree) {
          const rel = typeof filePath === "string" ? (() => {
            try {
              const { realpathSync } = require("node:fs");
              const { relative } = require("node:path");
              const { join: pjoin } = require("node:path");
              const wt = ctx.worktree;
              const abs = realpathSync(filePath.startsWith("/") ? filePath : pjoin(directory, filePath));
              const r = relative(wt, abs).split("\\\\").join("/");
              return r.startsWith("..") ? null : r;
            } catch { return null; }
          })() : null;
          if (hint) {
            recordHintFire({ ts: new Date().toISOString(), worktree: ctx.worktree, surface: "read", file: rel, count: 1 });
          }
          if (ctx.debtIds.length > 0) {
            recordHintFire({ ts: new Date().toISOString(), worktree: ctx.worktree, surface: "debt", file: rel, count: ctx.debtIds.length, ids: ctx.debtIds });
          }
          if (ctx.memLines.length > 0) {
            recordHintFire({ ts: new Date().toISOString(), worktree: ctx.worktree, surface: "mem", file: rel, count: ctx.memLines.length });
          }
        }
      } catch {
        // a hint must never break a read
      }
    },
  };
};
`;
}

/**
 * OpenCode plugin — the commit hint's in-process shape. `tool.execute.after`
 * on the bash tool: when the command contains `git commit` and the worktree
 * has ungraded commits, appends a nudge to the command output. Annotate only
 * (no decision:block — OpenCode has no stop-hook equivalent).
 *
 * Logic lives in src/hook.ts (commitHintFor) — same one-copy-per-client shape
 * as the read hint: a git pull in INSTALL_ROOT updates every client.
 */
export function commitHintPluginSource(root: string): string {
  const hookModule = JSON.stringify(join(root, "src", "hook.ts"));
  return `// fapony commit hint — annotates git commit bash commands with a
// verdict reminder when commits have no verdict filed yet.
// Annotate only: never blocks, never dedupes.
// Generated by \`fapony install\` — edit src/hook.ts in the fapony checkout.
import { commitHintFor, recordHintFire } from ${hookModule};

export const FaponyCommitHint = async ({ directory }) => {
  return {
    "tool.execute.after": async (input, output) => {
      try {
        if (input.tool !== "bash") return;
        const command = input.args?.command;
        const hint = commitHintFor({
          command,
          cwd: directory,
        });
        if (hint && typeof output.output === "string") {
          output.output = output.output + "\\n" + hint;
        }

        // --- hint-fire log (PLAN-feedback-surface chunk 1) ---
        // After output — best-effort, never block the hint.
        if (hint) {
          try {
            const { spawnSync } = require("node:child_process");
            const git = spawnSync("git", ["rev-parse", "--show-toplevel"], { cwd: directory, encoding: "utf-8" });
            if (git.status === 0) {
              const worktree = require("node:fs").realpathSync(git.stdout.trim());
              // Count commits from the hint message (lines starting with "fapony:   ").
              const commitLines = hint.split("\\n").filter(l => /^fapony:\\s+\\w{7,}/.test(l));
              recordHintFire({ ts: new Date().toISOString(), worktree, surface: "commit", file: null, count: commitLines.length || 1 });
            }
          } catch {
            // best-effort
          }
        }
      } catch {
        // a hint must never break a bash command
      }
    },
  };
};
`;
}

/**
 * OpenCode plugin — the edit hint's in-process shape. `tool.execute.after`
 * on the edit and write tools: when the touched file has importers, appends
 * the importer count plus the review-seed command that lists them. Annotate
 * only (no block, no dedupe beyond what editHintFor does itself).
 *
 * This is the OpenCode parity of Claude's Edit PreToolUse hook
 * (PLAN-edit-importer-hint): same shared logic (editHintFor in src/hook.ts),
 * same once-per-(session, file) dedupe, same `"edit"` fire surface. One
 * known difference: OpenCode's only annotate channel is `after`, so the hint
 * lands one step after the edit instead of before it — the `before` hook can
 * only mutate args or throw, and a hint must never block a tool call.
 *
 * `write` is guarded alongside `edit` for free: a write to a new file
 * resolves to null inside editHintFor (nothing imports it yet), so only a
 * write that overwrites an imported file fires. `apply_patch` is out of
 * scope — its paths live inside patchText, not filePath (separate plan).
 */
export function editHintPluginSource(root: string): string {
  const hookModule = JSON.stringify(join(root, "src", "hook.ts"));
  return `// fapony edit hint — annotates edits to source files that have importers
// with the importer count plus the review-seed command that lists them.
// Annotate only: never blocks, dedupe per (session, file) inside editHintFor.
// Generated by \`fapony install\` — edit src/hook.ts in the fapony checkout.
import { editHintFor, recordHintFire } from ${hookModule};

export const FaponyEditHint = async ({ directory }) => {
  return {
    "tool.execute.after": async (input, output) => {
      try {
        if (input.tool !== "edit" && input.tool !== "write") return;
        // The only channel that reaches the agent is output.output; if it is
        // not a string the hint cannot surface, so bail before editHintFor
        // spends the per-session dedupe row or logs a fire that never showed.
        if (typeof output.output !== "string") return;
        const filePath = input.args?.filePath;
        const hint = editHintFor({
          filePath,
          cwd: directory,
          session: input.sessionID,
        });

        // --- hint-fire log (PLAN-edit-importer-hint, opencode parity) ---
        // After output — best-effort, never block the hint.
        if (hint) {
          output.output = output.output + "\\n" + hint;
          try {
            const { spawnSync } = require("node:child_process");
            const git = spawnSync("git", ["rev-parse", "--show-toplevel"], { cwd: directory, encoding: "utf-8" });
            if (git.status === 0) {
              const worktree = require("node:fs").realpathSync(git.stdout.trim());
              const rel = typeof filePath === "string" ? (() => {
                try {
                  const { relative, join: pjoin } = require("node:path");
                  const abs = require("node:fs").realpathSync(filePath.startsWith("/") ? filePath : pjoin(directory, filePath));
                  const r = relative(worktree, abs).split("\\\\").join("/");
                  return r.startsWith("..") ? null : r;
                } catch { return null; }
              })() : null;
              recordHintFire({ ts: new Date().toISOString(), worktree, surface: "edit", file: rel, count: 1 });
            }
          } catch {
            // best-effort
          }
        }
      } catch {
        // a hint must never break an edit
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

function installCommitHintPlugin(dryRun: boolean, getHome: () => string): void {
  const pluginsDir = join(getHome(), ".config", "opencode", "plugins");
  const pluginPath = join(pluginsDir, "fapony-commit-hint.ts");
  if (existsSync(pluginPath)) {
    let current = "";
    try {
      current = readFileSync(pluginPath, "utf-8");
    } catch {
      current = "";
    }
    if (current.includes("commitHintFor")) {
      console.error(`  commit hint: already installed — no change`);
      return;
    }
    console.error(
      `  commit hint: ${pluginPath} exists but isn't fapony's — not overwriting.`,
    );
    return;
  }
  if (!dryRun) {
    try {
      mkdirSync(pluginsDir, { recursive: true });
      writeFileSync(pluginPath, commitHintPluginSource(INSTALL_ROOT), "utf-8");
    } catch (e) {
      console.error(`  commit hint: failed to write — ${(e as Error).message}`);
      return;
    }
  }
  console.error(
    `  commit hint: ${dryRun ? "would write" : "wrote"} ${pluginPath}`,
  );
}

function installEditHintPlugin(dryRun: boolean, getHome: () => string): void {
  const pluginsDir = join(getHome(), ".config", "opencode", "plugins");
  const pluginPath = join(pluginsDir, "fapony-edit-hint.ts");
  if (existsSync(pluginPath)) {
    let current = "";
    try {
      current = readFileSync(pluginPath, "utf-8");
    } catch {
      current = "";
    }
    if (current.includes("editHintFor")) {
      console.error(`  edit hint: already installed — no change`);
      return;
    }
    console.error(
      `  edit hint: ${pluginPath} exists but isn't fapony's — not overwriting.`,
    );
    return;
  }
  if (!dryRun) {
    try {
      mkdirSync(pluginsDir, { recursive: true });
      writeFileSync(pluginPath, editHintPluginSource(INSTALL_ROOT), "utf-8");
    } catch (e) {
      console.error(`  edit hint: failed to write — ${(e as Error).message}`);
      return;
    }
  }
  console.error(
    `  edit hint: ${dryRun ? "would write" : "wrote"} ${pluginPath}`,
  );
}
