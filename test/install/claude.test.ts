// test/install/claude.test.ts — Claude Code install provider

import assert from "node:assert";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  type ClaudeRunResult,
  claudeAddArgs,
  claudeGetArgs,
  claudeGetPointsToFapony,
  cmdInstall,
  cmdInstallClaude,
  INSTALL_ROOT,
  type InstallDeps,
} from "../../src/install.js";
import {
  captureErrors,
  silentErrors,
  type TestExit,
  testExit,
} from "./helpers.js";

/** Mock runner: map joined-argv → result. Records every call. */
function mapRun(table: Record<string, ClaudeRunResult | Error>): {
  run: (argv: string[]) => ClaudeRunResult;
  calls: string[];
} {
  const calls: string[] = [];
  const run = (argv: string[]): ClaudeRunResult => {
    calls.push(argv.join(" "));
    const hit = table[argv.join(" ")];
    if (hit instanceof Error) throw hit;
    if (hit) return hit;
    throw new Error(`unexpected argv: ${argv.join(" ")}`);
  };
  return { run, calls };
}

const GET = claudeGetArgs().join(" ");
const ABSENT: ClaudeRunResult = {
  exitCode: 1,
  stdout: "",
  stderr: 'No MCP server named "fapony".',
};
const PRESENT: ClaudeRunResult = {
  exitCode: 0,
  stdout: [
    "fapony:",
    "  Scope: User config (available in all your projects)",
    "  Type: stdio",
    "  Command: bun",
    `  Args: ${join(INSTALL_ROOT, "fapony.ts")} mcp`,
  ].join("\n"),
  stderr: "",
};
const ADDED: ClaudeRunResult = {
  exitCode: 0,
  stdout: "Added stdio MCP server fapony",
  stderr: "",
};

export function testClaudeAddUsesAbsolutePath(): void {
  const args = claudeAddArgs();
  assert.deepStrictEqual(args.slice(0, 7), [
    "claude",
    "mcp",
    "add",
    "fapony",
    "-s",
    "user",
    "--",
  ]);
  // Never relies on PATH: absolute fapony.ts + explicit `mcp` subcommand.
  assert.equal(args[7], "bun");
  assert.equal(args[8], join(INSTALL_ROOT, "fapony.ts"));
  assert.equal(args[9], "mcp");
  console.log("  ✓ install claude add uses absolute path");
}

export function testClaudeGetPointsToFapony(): void {
  assert.ok(claudeGetPointsToFapony(PRESENT.stdout));
  assert.ok(!claudeGetPointsToFapony("unrelated-server:\n  Command: node"));
  console.log("  ✓ install claude get ownership check");
}

export function testInstallClaudeAbsentAdds(): void {
  const ADD = claudeAddArgs().join(" ");
  const { run, calls } = mapRun({ [GET]: ABSENT, [ADD]: ADDED });
  // Tmp home: hook installers write settings.json — must never touch the
  // real ~/.claude during tests.
  const home = mkdtempSync(join(tmpdir(), "fapony-claude-home-"));
  const err = silentErrors(() =>
    captureErrors(() =>
      cmdInstallClaude(false, { run, exit: testExit, homedir: () => home }),
    ),
  );
  assert.deepStrictEqual(calls, [GET, ADD]);
  assert.ok(err.includes("configured for Claude Code"), `got: ${err}`);
  console.log("  ✓ install claude absent → add");
}

export function testInstallClaudeAlreadyConfiguredNoOp(): void {
  const { run, calls } = mapRun({ [GET]: PRESENT });
  // Tmp home: the no-op path still runs linkSkills — keep it off real ~/.claude.
  const home = mkdtempSync(join(tmpdir(), "fapony-claude-home-"));
  const err = silentErrors(() =>
    captureErrors(() =>
      cmdInstallClaude(false, { run, exit: testExit, homedir: () => home }),
    ),
  );
  assert.deepStrictEqual(calls, [GET]);
  assert.ok(err.includes("already configured"), `got: ${err}`);
  console.log("  ✓ install claude present → no-op");
}

export function testInstallClaudeDifferentCommandRefusesOverwrite(): void {
  const SQUAT: ClaudeRunResult = {
    exitCode: 0,
    stdout: "fapony:\n  Command: node\n  Args: /tmp/evil.js",
    stderr: "",
  };
  const { run, calls } = mapRun({ [GET]: SQUAT });
  let code: number | null = null;
  const err = silentErrors(() =>
    captureErrors(() => {
      try {
        cmdInstallClaude(false, { run, exit: testExit });
      } catch (e) {
        code = (e as TestExit).code;
      }
    }),
  );
  assert.equal(code, 1);
  assert.deepStrictEqual(calls, [GET]);
  assert.ok(err.includes("not overwriting"), `got: ${err}`);
  console.log("  ✓ install claude foreign entry → refuse overwrite");
}

export function testInstallClaudeDryRunNeverAdds(): void {
  const { run, calls } = mapRun({ [GET]: ABSENT });
  const err = silentErrors(() =>
    captureErrors(() => cmdInstallClaude(true, { run, exit: testExit })),
  );
  assert.deepStrictEqual(calls, [GET]);
  assert.ok(err.includes("dry-run"), `got: ${err}`);
  console.log("  ✓ install claude dry-run never adds");
}

export function testInstallClaudeMissingBinary(): void {
  const MISSING: ClaudeRunResult = {
    exitCode: 127,
    stdout: "",
    stderr: "ENOENT: no such file",
  };
  const { run } = mapRun({ [GET]: MISSING });
  let code: number | null = null;
  const err = silentErrors(() =>
    captureErrors(() => {
      try {
        cmdInstallClaude(false, { run, exit: testExit });
      } catch (e) {
        code = (e as TestExit).code;
      }
    }),
  );
  assert.equal(code, 1);
  assert.ok(err.includes("claude CLI not found"), `got: ${err}`);
  console.log("  ✓ install claude missing binary → clear error");
}

export function testInstallClaudeAddFailureHintsHelp(): void {
  const ADD = claudeAddArgs().join(" ");
  const FAILED: ClaudeRunResult = {
    exitCode: 1,
    stdout: "",
    stderr: "error: unknown option '--bogus'",
  };
  const { run } = mapRun({ [GET]: ABSENT, [ADD]: FAILED });
  let code: number | null = null;
  const err = silentErrors(() =>
    captureErrors(() => {
      try {
        cmdInstallClaude(false, { run, exit: testExit });
      } catch (e) {
        code = (e as TestExit).code;
      }
    }),
  );
  assert.equal(code, 1);
  assert.ok(err.includes("claude mcp add --help"), `got: ${err}`);
  console.log("  ✓ install claude add failure hints --help");
}

export async function testCmdInstallDispatchesClaude(): Promise<void> {
  // cmdInstall routes --platform claude through the same seam (3rd case:
  // dispatch itself, alongside absent/present/different above).
  const ADD = claudeAddArgs().join(" ");
  const { run, calls } = mapRun({ [GET]: ABSENT, [ADD]: ADDED });
  const deps: InstallDeps = { run, exit: testExit };
  await silentErrors(() => cmdInstall(["install", "claude"].slice(1), deps));
  assert.deepStrictEqual(calls, [GET, ADD]);
  console.log("  ✓ install dispatch routes --platform claude");
}

export function testInstallClaudeStopHookAppendsOnceAndKeepsForeign(): void {
  const home = mkdtempSync(join(tmpdir(), "fapony-claude-home-"));
  const claudeDir = join(home, ".claude");
  mkdirSync(claudeDir, { recursive: true });
  // A Stop hook someone else registered must survive — Claude Code runs every
  // entry in the array, so the correct move is append, never replace.
  writeFileSync(
    join(claudeDir, "settings.json"),
    JSON.stringify({
      hooks: {
        Stop: [{ hooks: [{ type: "command", command: "/tmp/theirs" }] }],
      },
    }),
  );
  const ADD = claudeAddArgs().join(" ");
  const read = () =>
    JSON.parse(readFileSync(join(claudeDir, "settings.json"), "utf-8")) as {
      hooks: { Stop: unknown[] };
    };

  for (let i = 0; i < 2; i++) {
    const { run } = mapRun({ [GET]: ABSENT, [ADD]: ADDED });
    silentErrors(() =>
      captureErrors(() =>
        cmdInstallClaude(false, { run, exit: testExit, homedir: () => home }),
      ),
    );
  }

  const stop = read().hooks.Stop;
  assert.equal(stop.length, 2, "installing twice must not duplicate the hook");
  assert.ok(
    JSON.stringify(stop[0]).includes("/tmp/theirs"),
    "foreign Stop hook must survive",
  );
  assert.ok(
    JSON.stringify(stop[1]).includes("hook-stop"),
    "fapony's Stop hook must be registered",
  );
  console.log("  ✓ install claude stop hook → appends once, keeps foreign");
}

export function testInstallClaudeReadHintAppendsOnce(): void {
  const home = mkdtempSync(join(tmpdir(), "fapony-claude-home-"));
  const claudeDir = join(home, ".claude");
  mkdirSync(claudeDir, { recursive: true });
  const ADD = claudeAddArgs().join(" ");
  const read = () =>
    JSON.parse(readFileSync(join(claudeDir, "settings.json"), "utf-8")) as {
      hooks: { PreToolUse: Array<Record<string, unknown>> };
    };

  for (let i = 0; i < 2; i++) {
    const { run } = mapRun({ [GET]: ABSENT, [ADD]: ADDED });
    silentErrors(() =>
      captureErrors(() =>
        cmdInstallClaude(false, { run, exit: testExit, homedir: () => home }),
      ),
    );
  }

  const pre = read().hooks.PreToolUse;
  assert.equal(pre.length, 2, "installing twice must not duplicate");
  const byMatcher = new Map(pre.map((e) => [e.matcher, e]));
  assert.ok(byMatcher.has("Read"), "Read hint entry must be registered");
  assert.ok(
    JSON.stringify(byMatcher.get("Read")).includes("hook-read-hint"),
    "read hint command must be registered",
  );
  assert.ok(byMatcher.has("Edit"), "Edit hint entry must be registered");
  assert.ok(
    JSON.stringify(byMatcher.get("Edit")).includes("hook-edit-hint"),
    "edit hint command must be registered",
  );
  console.log(
    "  ✓ install claude read+edit hints → PreToolUse matchers Read/Edit, append once",
  );
}

export function testInstallClaudeEditHintAppendsOnce(): void {
  const home = mkdtempSync(join(tmpdir(), "fapony-claude-home-"));
  const claudeDir = join(home, ".claude");
  mkdirSync(claudeDir, { recursive: true });
  // A foreign PreToolUse entry (another tool's hook) must survive — Claude
  // Code runs every entry in the array, so the correct move is append.
  writeFileSync(
    join(claudeDir, "settings.json"),
    JSON.stringify({
      hooks: {
        PreToolUse: [
          {
            matcher: "Bash",
            hooks: [{ type: "command", command: "/tmp/theirs" }],
          },
        ],
      },
    }),
  );
  const ADD = claudeAddArgs().join(" ");
  const read = () =>
    JSON.parse(readFileSync(join(claudeDir, "settings.json"), "utf-8")) as {
      hooks: { PreToolUse: Array<Record<string, unknown>> };
    };

  for (let i = 0; i < 2; i++) {
    const { run } = mapRun({ [GET]: ABSENT, [ADD]: ADDED });
    silentErrors(() =>
      captureErrors(() =>
        cmdInstallClaude(false, { run, exit: testExit, homedir: () => home }),
      ),
    );
  }

  const pre = read().hooks.PreToolUse;
  assert.equal(pre.length, 3, "installing twice must not duplicate");
  assert.ok(
    JSON.stringify(pre[0]).includes("/tmp/theirs"),
    "foreign PreToolUse hook must survive",
  );
  const edit = pre.find((e) => e.matcher === "Edit");
  assert.ok(edit, "Edit matcher entry must be registered");
  assert.ok(
    JSON.stringify(edit).includes("hook-edit-hint"),
    "edit hint command must be registered",
  );
  console.log(
    "  ✓ install claude edit hint → PreToolUse matcher Edit, appends once, keeps foreign",
  );
}

export function testInstallClaudeAlreadyConfiguredStillInstallsHooks(): void {
  const home = mkdtempSync(join(tmpdir(), "fapony-claude-home-"));
  const { run, calls } = mapRun({ [GET]: PRESENT });
  silentErrors(() =>
    captureErrors(() =>
      cmdInstallClaude(false, { run, exit: testExit, homedir: () => home }),
    ),
  );
  // MCP already wired → no add call, but the hooks must still be written so a
  // hook added later (the Edit hint) reaches an existing install.
  assert.deepStrictEqual(calls, [GET]);
  const settings = JSON.parse(
    readFileSync(join(home, ".claude", "settings.json"), "utf-8"),
  ) as { hooks: { PreToolUse: Array<Record<string, unknown>> } };
  const matchers = settings.hooks.PreToolUse.map((e) => e.matcher);
  assert.ok(matchers.includes("Read"), "Read hint must be written on upgrade");
  assert.ok(matchers.includes("Edit"), "Edit hint must be written on upgrade");
  console.log("  ✓ install claude already-configured → still wires hooks");
}
