// src/install/claude.ts — Claude Code install provider
//
// Skills symlink + the PreToolUse hooks fapony still owns. Memory (MCP, Stop,
// SessionStart, per-file read context) moved to fael — `fael install` wires it.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { claudeSkillsDir, linkSkills, reportSkills } from "./skills.js";
import { INSTALL_ROOT, type InstallDeps } from "./types.js";

export function cmdInstallClaude(
  dryRun: boolean,
  deps: InstallDeps = {},
): void {
  const dir = claudeSkillsDir(deps.homedir ?? homedir);
  reportSkills(linkSkills(dir, dryRun), dir, dryRun);
  removeRetiredClaudeHooks(dryRun, deps);
  installClaudeHooks(dryRun, deps);
}

/** Hook subcommands fapony used to register — memory hooks moved to fael,
 *  the edit hint was cut 2026-09-26 (never moved an agent to migrate). The
 *  commands are gone, so a leftover entry would error on every tool call. */
const RETIRED_SUBCOMMANDS = [
  "hook-read-hint",
  "hook-stop",
  "hook-session-start",
  "hook-edit-hint",
];

function isRetired(command: unknown): boolean {
  return (
    typeof command === "string" &&
    command.includes("fapony") &&
    RETIRED_SUBCOMMANDS.some((sub) => command.endsWith(` ${sub}`))
  );
}

/** Drop fapony's own retired hook entries from settings.json; foreign entries
 *  are never touched. An unreadable settings.json is left alone. */
function removeRetiredClaudeHooks(dryRun: boolean, deps: InstallDeps): void {
  const home = deps.homedir ? deps.homedir() : homedir();
  const settingsPath = join(home, ".claude", "settings.json");
  let settings: { hooks?: Record<string, unknown> };
  try {
    settings = JSON.parse(readFileSync(settingsPath, "utf-8"));
  } catch {
    return;
  }
  const hooks = settings.hooks;
  if (!hooks || typeof hooks !== "object") return;
  let removed = 0;
  for (const [event, list] of Object.entries(hooks)) {
    if (!Array.isArray(list)) continue;
    const kept = list.flatMap((group: { hooks?: { command?: unknown }[] }) => {
      if (!Array.isArray(group?.hooks)) return [group];
      const inner = group.hooks.filter((h) => !isRetired(h?.command));
      removed += group.hooks.length - inner.length;
      return inner.length === 0 ? [] : [{ ...group, hooks: inner }];
    });
    if (kept.length === 0) delete hooks[event];
    else hooks[event] = kept;
  }
  if (removed === 0) return;
  if (!dryRun) {
    try {
      writeFileSync(
        settingsPath,
        `${JSON.stringify(settings, null, 2)}\n`,
        "utf-8",
      );
    } catch (e) {
      console.error(
        `  retired hooks: failed to write — ${(e as Error).message}`,
      );
      return;
    }
  }
  console.error(
    `  retired hooks: ${dryRun ? "would remove" : "removed"} ${removed} fapony entr${removed === 1 ? "y" : "ies"}`,
  );
}

/**
 * Append-to-settings.json hook installer (caller: plan-mv guard).
 * Never touch a hook someone else registered, never fail the install over it.
 */
function ensureClaudeHook(
  dryRun: boolean,
  deps: InstallDeps,
  hook: { event: string; matcher?: string; subcommand: string; label: string },
): void {
  const home = deps.homedir ? deps.homedir() : homedir();
  const claudeDir = join(home, ".claude");
  const settingsPath = join(claudeDir, "settings.json");
  const command = `bun ${join(INSTALL_ROOT, "fapony.ts")} ${hook.subcommand}`;

  let settings: Record<string, unknown> = {};
  if (existsSync(settingsPath)) {
    try {
      settings = JSON.parse(readFileSync(settingsPath, "utf-8")) as Record<
        string,
        unknown
      >;
    } catch {
      console.error(
        `  ${hook.label}: ${settingsPath} is unreadable or malformed — skipping`,
      );
      return;
    }
  }

  const hooks = (settings.hooks ?? {}) as Record<string, unknown>;
  const list = Array.isArray(hooks[hook.event])
    ? (hooks[hook.event] as unknown[])
    : [];
  if (JSON.stringify(list).includes(hook.subcommand)) {
    console.error(
      `  ${hook.label}: already configured in settings.json — no change`,
    );
    return;
  }

  // Append rather than replace: other tools register hooks too, and
  // Claude Code runs every entry in the array.
  list.push({
    ...(hook.matcher ? { matcher: hook.matcher } : {}),
    hooks: [{ type: "command", command }],
  });
  hooks[hook.event] = list;
  settings.hooks = hooks;

  if (!dryRun) {
    try {
      if (!existsSync(claudeDir)) mkdirSync(claudeDir, { recursive: true });
      writeFileSync(
        settingsPath,
        `${JSON.stringify(settings, null, 2)}\n`,
        "utf-8",
      );
    } catch (e) {
      console.error(
        `  ${hook.label}: failed to write — ${(e as Error).message}`,
      );
      return;
    }
  }
  console.error(
    `  ${hook.label}: ${dryRun ? "would write" : "wrote"} hooks.${hook.event} → ${settingsPath}`,
  );
}

/** Wire every hook fapony owns — the plan-mv guard. Idempotent and dry-run-safe. */
function installClaudeHooks(dryRun: boolean, deps: InstallDeps): void {
  installMvGuardHook(dryRun, deps);
}

/**
 * PreToolUse hook on Bash: denies a raw `git mv` of a plan file into a done/
 * directory, pointing at `fapony plan sweep --apply` instead — that
 * command does the link rewrite a plain `git mv` skips. The one fapony hook
 * that blocks besides Stop; matcher "Bash" keeps the spawn off every other
 * tool call.
 */
function installMvGuardHook(dryRun: boolean, deps: InstallDeps): void {
  ensureClaudeHook(dryRun, deps, {
    event: "PreToolUse",
    matcher: "Bash",
    subcommand: "hook-mv-guard",
    label: "plan-mv guard",
  });
}
