// src/install/claude.ts — Claude Code install provider
//
// Shells out to `claude mcp add` (never parses/writes ~/.claude.json directly).

import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { assertSafe } from "../safety.js";
import { claudeSkillsDir, linkSkills, reportSkills } from "./skills.js";
import {
  type ClaudeRunResult,
  defaultExit,
  INSTALL_ROOT,
  type InstallDeps,
} from "./types.js";

function defaultRun(argv: string[]): ClaudeRunResult {
  assertSafe(argv);
  try {
    const proc = Bun.spawnSync(argv, {
      stdout: "pipe",
      stderr: "pipe",
    });
    return {
      exitCode: proc.exitCode,
      stdout: proc.stdout.toString(),
      stderr: proc.stderr.toString(),
    };
  } catch (e) {
    // `claude` binary missing (ENOENT) or spawn failed outright.
    return { exitCode: 127, stdout: "", stderr: (e as Error).message };
  }
}

/** `claude mcp get fapony` — read-only probe. exit 0 = an entry named fapony exists. */
export function claudeGetArgs(): string[] {
  return ["claude", "mcp", "get", "fapony"];
}

/** Absolute-path add command — works even before `bun link` puts `fapony` on PATH. */
export function claudeAddArgs(): string[] {
  return [
    "claude",
    "mcp",
    "add",
    "fapony",
    "-s",
    "user",
    "--",
    "bun",
    join(INSTALL_ROOT, "fapony.ts"),
    "mcp",
  ];
}

function isClaudeMissing(res: ClaudeRunResult): boolean {
  return (
    res.exitCode === 127 ||
    /ENOENT|command not found|not found/i.test(res.stderr) ||
    /ENOENT|command not found|not found/i.test(res.stdout)
  );
}

/**
 * An existing `fapony` entry counts as ours when its Command:/Args: lines
 * mention fapony (covers both `bun <abs>/fapony.ts mcp` and `fapony mcp`
 * launchers). Only those lines are inspected — the `fapony:` header matches
 * trivially and proves nothing. Anything else under our name is someone
 * else's entry — never overwrite it silently.
 */
export function claudeGetPointsToFapony(getOutput: string): boolean {
  const cmdLines = getOutput
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.startsWith("Command:") || l.startsWith("Args:"));
  return cmdLines.join("\n").includes("fapony");
}

export function cmdInstallClaude(
  dryRun: boolean,
  deps: InstallDeps = {},
): void {
  const run = deps.run ?? defaultRun;
  const exitFn = deps.exit ?? defaultExit;

  const getArgs = claudeGetArgs();
  assertSafe(getArgs);
  const get = run(getArgs);
  if (isClaudeMissing(get)) {
    console.error(`claude CLI not found — install Claude Code first`);
    exitFn(1);
    return;
  }

  if (get.exitCode === 0) {
    if (claudeGetPointsToFapony(`${get.stdout}\n${get.stderr}`)) {
      console.error(`✓ mcp.fapony already configured — no change needed`);
      console.error(`  (Claude Code user scope)`);
      const dir = claudeSkillsDir(deps.homedir ?? homedir);
      reportSkills(linkSkills(dir, dryRun), dir, dryRun);
      return;
    }
    console.error(
      `an MCP server named "fapony" exists but points elsewhere — not overwriting.`,
    );
    console.error(`  inspect with: claude mcp get fapony`);
    console.error(`  then remove it first: claude mcp remove fapony -s user`);
    exitFn(1);
    return;
  }

  const addArgs = claudeAddArgs();
  if (dryRun) {
    console.error(`── dry-run: would run ──`);
    console.error(`  ${addArgs.join(" ")}`);
    return;
  }

  assertSafe(addArgs);
  const add = run(addArgs);
  if (isClaudeMissing(add)) {
    console.error(`claude CLI not found — install Claude Code first`);
    exitFn(1);
    return;
  }
  if (add.exitCode !== 0) {
    console.error(
      `failed to add mcp.fapony to Claude Code (exit ${add.exitCode})`,
    );
    const detail = `${add.stdout}\n${add.stderr}`.trim();
    if (detail) console.error(detail);
    console.error(`verify with: claude mcp add --help`);
    exitFn(1);
    return;
  }
  console.error(`✓ mcp.fapony configured for Claude Code (user scope)`);
  const skillsDir = claudeSkillsDir(deps.homedir ?? homedir);
  reportSkills(linkSkills(skillsDir, dryRun), skillsDir, dryRun);

  // Wire statusline: copy script + update settings.json.
  installStatusline(dryRun, deps);

  // Wire the Stop hook that refuses to end a turn with ungraded commits,
  // and the Read hint that annotates large-file reads (annotate-only).
  installStopHook(dryRun, deps);
  installReadHintHook(dryRun, deps);
}

/**
 * Copy the statusline script to ~/.claude/statusline.sh and add the
 * statusLine field to ~/.claude/settings.json. Best-effort — never fails
 * the install if settings.json is unreadable or has unexpected shape.
 */
function installStatusline(dryRun: boolean, deps: InstallDeps): void {
  const home = deps.homedir ? deps.homedir() : homedir();
  const claudeDir = join(home, ".claude");
  const scriptSrc = join(INSTALL_ROOT, "statusline", "claude-statusline.sh");
  const scriptDest = join(claudeDir, "statusline.sh");
  const settingsPath = join(claudeDir, "settings.json");

  // 1. Copy the statusline script — never overwrite someone else's.
  // Mirrors the mcp-entry policy above: an existing script that isn't ours
  // is left alone (the settings guard below will also refuse to repoint it).
  if (!existsSync(scriptSrc)) {
    console.error(`  statusline: script not found at ${scriptSrc} — skipping`);
    return;
  }
  if (existsSync(scriptDest)) {
    let current = "";
    try {
      current = readFileSync(scriptDest, "utf-8");
    } catch {
      current = "";
    }
    if (!current.includes("fapony")) {
      console.error(
        `  statusline: ${scriptDest} exists but isn't fapony's — not overwriting.`,
      );
      console.error(
        `  inspect it first, then remove it to let fapony install its own.`,
      );
      return;
    }
  }
  try {
    if (!existsSync(claudeDir)) mkdirSync(claudeDir, { recursive: true });
    if (!dryRun) copyFileSync(scriptSrc, scriptDest);
    // Claude Code execs this file — the copy must stay executable.
    if (!dryRun) chmodSync(scriptDest, 0o755);
    console.error(
      `  statusline: ${dryRun ? "would copy" : "copied"} ${scriptDest}`,
    );
  } catch (e) {
    console.error(
      `  statusline: failed to copy script — ${(e as Error).message}`,
    );
    return;
  }

  // 2. Update settings.json with statusLine field.
  let settings: Record<string, unknown> = {};
  if (existsSync(settingsPath)) {
    try {
      settings = JSON.parse(readFileSync(settingsPath, "utf-8")) as Record<
        string,
        unknown
      >;
    } catch {
      console.error(
        `  statusline: ${settingsPath} is unreadable or malformed — skipping settings update`,
      );
      return;
    }
  }

  // Don't overwrite if already configured (same command path). A foreign
  // statusLine (someone else's command) is left alone — same policy as the
  // mcp-entry "points elsewhere" refusal above. Match on our exact dest:
  // any *statusline.sh substring (e.g. another plugin's script) is not ours.
  const existing = settings.statusLine as Record<string, unknown> | undefined;
  if (
    existing &&
    existing.type === "command" &&
    typeof existing.command === "string" &&
    existing.command === scriptDest
  ) {
    console.error(
      `  statusline: already configured in settings.json — no change`,
    );
    return;
  }
  if (existing && typeof existing === "object") {
    console.error(
      `  statusline: settings.json already has a statusLine that isn't fapony's — not overwriting.`,
    );
    console.error(
      `  inspect it first, then remove it to let fapony wire its own.`,
    );
    return;
  }

  settings.statusLine = {
    type: "command",
    command: scriptDest,
  };

  if (!dryRun) {
    writeFileSync(
      settingsPath,
      `${JSON.stringify(settings, null, 2)}\n`,
      "utf-8",
    );
  }
  console.error(
    `  statusline: ${dryRun ? "would write" : "wrote"} statusLine → ${settingsPath}`,
  );
}

/**
 * Shared append-to-settings.json hook installer. Both fapony hooks live
 * here now (Stop since PLAN-mem-mcp, PreToolUse read hint since the
 * large-file annotate feature) — the read/write/idempotence/append shape
 * is one implementation with two callers, not a scaffold.
 * Same policy as installStatusline: never touch a hook someone else
 * registered, never fail the install over it.
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

function installStopHook(dryRun: boolean, deps: InstallDeps): void {
  ensureClaudeHook(dryRun, deps, {
    event: "Stop",
    subcommand: "hook-stop",
    label: "stop hook",
  });
}

/**
 * PreToolUse hook on Read: annotates a full-file read of a large source file
 * with one factual line (size + the review-seed command). Annotate only —
 * no permissionDecision is ever returned, the read always proceeds; and no
 * "already read" dedupe (context compaction makes that claim false). The
 * matcher "Read" keeps the spawn off every other tool call.
 */
function installReadHintHook(dryRun: boolean, deps: InstallDeps): void {
  ensureClaudeHook(dryRun, deps, {
    event: "PreToolUse",
    matcher: "Read",
    subcommand: "hook-read-hint",
    label: "read hint",
  });
}
