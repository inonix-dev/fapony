import assert from "node:assert";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readlinkSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  agentsSkillsDir,
  type ClaudeRunResult,
  claudeAddArgs,
  claudeGetArgs,
  claudeGetPointsToFapony,
  cmdInstall,
  cmdInstallClaude,
  cmdInstallCodex,
  cmdInstallOpencode,
  cmdInstallZcode,
  detectClients,
  INSTALL_ROOT,
  type InstallDeps,
  linkSkills,
} from "../src/install.js";
import { silentErrors } from "./helpers.js";

class TestExit extends Error {
  code: number;
  constructor(code: number) {
    super(`exit:${code}`);
    this.code = code;
  }
}

function testExit(code: number): never {
  throw new TestExit(code);
}

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

function captureErrors(fn: () => void): string {
  const lines: string[] = [];
  const orig = console.error;
  console.error = (...a: unknown[]) => {
    lines.push(a.map(String).join(" "));
  };
  try {
    fn();
  } finally {
    console.error = orig;
  }
  return lines.join("\n");
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

export function testInstallRootIsRepoRoot(): void {
  assert.ok(
    existsSync(join(INSTALL_ROOT, "package.json")),
    `INSTALL_ROOT must be the repo root, got: ${INSTALL_ROOT}`,
  );
  assert.ok(
    existsSync(join(INSTALL_ROOT, "fapony.ts")),
    `INSTALL_ROOT must contain fapony.ts, got: ${INSTALL_ROOT}`,
  );
  console.log("  ✓ install INSTALL_ROOT is repo root");
}

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
  // Tmp home: installStatusline copies the script + writes settings.json —
  // must never touch the real ~/.claude during tests.
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

export function testInstallClaudeForeignStatuslineRefusesOverwrite(): void {
  const home = mkdtempSync(join(tmpdir(), "fapony-claude-home-"));
  const claudeDir = join(home, ".claude");
  mkdirSync(claudeDir, { recursive: true });
  const before = JSON.stringify({
    statusLine: { type: "command", command: "/tmp/mine.sh" },
    other: 1,
  });
  writeFileSync(join(claudeDir, "settings.json"), before);
  const ADD = claudeAddArgs().join(" ");
  const { run } = mapRun({ [GET]: ABSENT, [ADD]: ADDED });
  const err = silentErrors(() =>
    captureErrors(() =>
      cmdInstallClaude(false, { run, exit: testExit, homedir: () => home }),
    ),
  );
  // Assert the statusLine field, not the whole file: the Stop-hook installer
  // legitimately adds hooks.Stop to the same settings.json in this same run.
  const after = JSON.parse(
    readFileSync(join(claudeDir, "settings.json"), "utf-8"),
  ) as Record<string, unknown>;
  assert.deepEqual(
    after.statusLine,
    { type: "command", command: "/tmp/mine.sh" },
    "foreign statusLine must not be overwritten",
  );
  assert.equal(after.other, 1, "unrelated keys must survive");
  assert.ok(err.includes("isn't fapony's"), `got: ${err}`);
  console.log("  ✓ install claude foreign statusLine → refuse overwrite");
}

export function testInstallClaudeForeignScriptRefusesOverwrite(): void {
  const home = mkdtempSync(join(tmpdir(), "fapony-claude-home-"));
  const claudeDir = join(home, ".claude");
  mkdirSync(claudeDir, { recursive: true });
  writeFileSync(join(claudeDir, "statusline.sh"), "#!/bin/bash\necho mine\n");
  const ADD = claudeAddArgs().join(" ");
  const { run } = mapRun({ [GET]: ABSENT, [ADD]: ADDED });
  const err = silentErrors(() =>
    captureErrors(() =>
      cmdInstallClaude(false, { run, exit: testExit, homedir: () => home }),
    ),
  );
  assert.equal(
    readFileSync(join(claudeDir, "statusline.sh"), "utf-8"),
    "#!/bin/bash\necho mine\n",
    "foreign script must not be overwritten",
  );
  assert.ok(err.includes("isn't fapony's"), `got: ${err}`);
  console.log("  ✓ install claude foreign script → refuse overwrite");
}

export function testInstallClaudeStatuslineWiresSettings(): void {
  const home = mkdtempSync(join(tmpdir(), "fapony-claude-home-"));
  const ADD = claudeAddArgs().join(" ");
  const { run } = mapRun({ [GET]: ABSENT, [ADD]: ADDED });
  silentErrors(() =>
    captureErrors(() =>
      cmdInstallClaude(false, { run, exit: testExit, homedir: () => home }),
    ),
  );
  const scriptDest = join(home, ".claude", "statusline.sh");
  assert.ok(existsSync(scriptDest), "statusline script copied");
  const settings = JSON.parse(
    readFileSync(join(home, ".claude", "settings.json"), "utf-8"),
  ) as { statusLine?: { type?: unknown; command?: unknown } };
  assert.equal(settings.statusLine?.type, "command");
  assert.equal(settings.statusLine?.command, scriptDest);
  console.log("  ✓ install claude wires statusline script + settings");
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

export async function testCmdInstallRejectsUnknownPlatform(): Promise<void> {
  let code: number | null = null;
  const lines: string[] = [];
  const orig = console.error;
  console.error = (...a: unknown[]) => {
    lines.push(a.map(String).join(" "));
  };
  try {
    await cmdInstall(["windows"], { exit: testExit });
  } catch (e) {
    code = (e as TestExit).code;
  } finally {
    console.error = orig;
  }
  const err = lines.join("\n");
  assert.equal(code, 1);
  assert.ok(err.includes("opencode|claude|zcode"), `got: ${err}`);
  console.log("  ✓ install rejects unknown platform");
}

// --- zcode platform tests ---

function withTempHome<T>(fn: (home: string) => T): T {
  const home = mkdtempSync(join(tmpdir(), "fapony-home-"));
  try {
    return fn(home);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
}

function writeJson(path: string, obj: unknown): void {
  writeFileSync(path, `${JSON.stringify(obj, null, 2)}\n`);
}

function zcodeEntry(): Record<string, unknown> {
  return {
    type: "stdio",
    command: "bun",
    args: ["run", join(INSTALL_ROOT, "fapony.ts"), "mcp"],
  };
}

export function testInstallZcodeNoConfigFails(): void {
  withTempHome((home) => {
    let code: number | null = null;
    const err = silentErrors(() =>
      captureErrors(() => {
        try {
          cmdInstallZcode(false, { exit: testExit, homedir: () => home });
        } catch (e) {
          code = (e as TestExit).code;
        }
      }),
    );
    assert.equal(code, 1);
    assert.ok(err.includes("ZCode config not found"), `got: ${err}`);
    console.log("  ✓ install zcode no config → clear error");
  });
}

export function testInstallZcodePrimaryPath(): void {
  withTempHome((home) => {
    const configDir = join(home, ".zcode", "cli");
    mkdirSync(configDir, { recursive: true });
    const configPath = join(configDir, "config.json");
    writeJson(configPath, {
      mcp: {
        servers: { other: { type: "stdio", command: "node", args: ["x.js"] } },
      },
    });

    const err = silentErrors(() =>
      captureErrors(() =>
        cmdInstallZcode(false, { exit: testExit, homedir: () => home }),
      ),
    );
    const cfg = JSON.parse(readFileSync(configPath, "utf-8")) as Record<
      string,
      unknown
    >;
    const servers = (cfg.mcp as Record<string, unknown>).servers as Record<
      string,
      unknown
    >;
    assert.deepStrictEqual(servers.fapony, zcodeEntry());
    assert.deepStrictEqual(servers.other, {
      type: "stdio",
      command: "node",
      args: ["x.js"],
    });
    assert.ok(err.includes("added mcp.fapony"), `got: ${err}`);
    console.log(
      "  ✓ install zcode primary path → writes ~/.zcode/cli/config.json",
    );
  });
}

export function testInstallZcodeFallbackPath(): void {
  withTempHome((home) => {
    const agentsDir = join(home, ".agents");
    mkdirSync(agentsDir, { recursive: true });
    const configPath = join(agentsDir, "mcp.json");
    writeJson(configPath, {
      mcpServers: { other: { type: "stdio", command: "node", args: ["x.js"] } },
    });

    const err = silentErrors(() =>
      captureErrors(() =>
        cmdInstallZcode(false, { exit: testExit, homedir: () => home }),
      ),
    );
    const cfg = JSON.parse(readFileSync(configPath, "utf-8")) as Record<
      string,
      unknown
    >;
    const servers = cfg.mcpServers as Record<string, unknown>;
    assert.deepStrictEqual(servers.fapony, zcodeEntry());
    assert.ok(err.includes("fallback path: ~/.agents/mcp.json"), `got: ${err}`);
    console.log("  ✓ install zcode fallback path → writes ~/.agents/mcp.json");
  });
}

export function testInstallZcodeAlreadyConfiguredNoOp(): void {
  withTempHome((home) => {
    const configDir = join(home, ".zcode", "cli");
    mkdirSync(configDir, { recursive: true });
    const configPath = join(configDir, "config.json");
    writeJson(configPath, { mcp: { servers: { fapony: zcodeEntry() } } });

    const before = readFileSync(configPath, "utf-8");
    const err = silentErrors(() =>
      captureErrors(() =>
        cmdInstallZcode(false, { exit: testExit, homedir: () => home }),
      ),
    );
    const after = readFileSync(configPath, "utf-8");
    assert.equal(before, after);
    assert.ok(err.includes("already configured"), `got: ${err}`);
    console.log("  ✓ install zcode already configured → no-op");
  });
}

export function testInstallZcodeDryRunNoWrite(): void {
  withTempHome((home) => {
    const configDir = join(home, ".zcode", "cli");
    mkdirSync(configDir, { recursive: true });
    const configPath = join(configDir, "config.json");
    writeJson(configPath, {});

    const before = readFileSync(configPath, "utf-8");
    const err = silentErrors(() =>
      captureErrors(() =>
        cmdInstallZcode(true, { exit: testExit, homedir: () => home }),
      ),
    );
    const after = readFileSync(configPath, "utf-8");
    assert.equal(before, after);
    assert.ok(err.includes("dry-run"), `got: ${err}`);
    assert.ok(err.includes("mcp.servers.fapony"), `got: ${err}`);
    console.log("  ✓ install zcode dry-run → no write");
  });
}

export function testInstallZcodeLinksSkillsIntoAgentsDir(): void {
  withTempHome((home) => {
    const configDir = join(home, ".zcode", "cli");
    mkdirSync(configDir, { recursive: true });
    writeJson(join(configDir, "config.json"), {});

    silentErrors(() =>
      captureErrors(() =>
        cmdInstallZcode(false, { exit: testExit, homedir: () => home }),
      ),
    );
    const dir = agentsSkillsDir(() => home);
    assert.equal(dir, join(home, ".agents", "skills"));
    const names = skillNames();
    assert.ok(names.length > 0, "repo should ship at least one skill");
    for (const name of names) {
      assert.ok(
        lstatSync(join(dir, name)).isSymbolicLink(),
        `${name} should be symlinked into ~/.agents/skills`,
      );
    }
    console.log("  ✓ install zcode → symlinks skills into ~/.agents/skills");
  });
}

export function testCmdInstallDispatchesZcode(): void {
  withTempHome((home) => {
    const configDir = join(home, ".zcode", "cli");
    mkdirSync(configDir, { recursive: true });
    const configPath = join(configDir, "config.json");
    writeJson(configPath, {});

    silentErrors(() =>
      cmdInstall(["zcode"], { exit: testExit, homedir: () => home }),
    );
    const cfg = JSON.parse(readFileSync(configPath, "utf-8")) as Record<
      string,
      unknown
    >;
    const servers = (cfg.mcp as Record<string, unknown>).servers as Record<
      string,
      unknown
    >;
    assert.deepStrictEqual(servers.fapony, zcodeEntry());
    console.log("  ✓ install dispatch routes --platform zcode");
  });
}

// --- skill symlinks ---

function skillNames(): string[] {
  const { readdirSync } = require("node:fs") as typeof import("node:fs");
  return readdirSync(join(INSTALL_ROOT, "skill"), { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .sort();
}

export function testLinkSkillsCreatesSymlinks(): void {
  const dir = mkdtempSync(join(tmpdir(), "fapony-skills-"));
  try {
    const results = linkSkills(dir, false);
    const names = skillNames();
    assert.ok(names.length > 0, "repo should ship at least one skill");
    assert.deepStrictEqual(
      results.map((r) => r.name),
      names,
    );
    assert.ok(results.every((r) => r.action === "linked"));
    for (const name of names) {
      const dest = join(dir, name);
      assert.ok(
        lstatSync(dest).isSymbolicLink(),
        `${name} should be a symlink`,
      );
      assert.strictEqual(readlinkSync(dest), join(INSTALL_ROOT, "skill", name));
      // the link must resolve to the real SKILL.md, not just exist
      assert.ok(existsSync(join(dest, "SKILL.md")));
    }
    console.log("  ✓ linkSkills symlinks each skill dir");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

export function testLinkSkillsIdempotent(): void {
  const dir = mkdtempSync(join(tmpdir(), "fapony-skills-"));
  try {
    linkSkills(dir, false);
    const second = linkSkills(dir, false);
    assert.ok(
      second.every((r) => r.action === "already"),
      "re-linking should report already, not conflict",
    );
    console.log("  ✓ linkSkills is idempotent");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

export function testLinkSkillsRefusesOverwrite(): void {
  const dir = mkdtempSync(join(tmpdir(), "fapony-skills-"));
  try {
    const victim = skillNames()[0];
    mkdirSync(join(dir, victim), { recursive: true });
    writeFileSync(join(dir, victim, "SKILL.md"), "# not fapony's\n");

    const results = linkSkills(dir, false);
    const hit = results.find((r) => r.name === victim);
    assert.strictEqual(hit?.action, "conflict");
    assert.strictEqual(
      readFileSync(join(dir, victim, "SKILL.md"), "utf-8"),
      "# not fapony's\n",
      "an existing skill must survive untouched",
    );
    assert.ok(
      results.some((r) => r.action === "linked"),
      "one conflict must not block the other skills",
    );
    console.log("  ✓ linkSkills never overwrites an existing skill");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

export function testLinkSkillsDryRunNoWrite(): void {
  const dir = mkdtempSync(join(tmpdir(), "fapony-skills-"));
  try {
    const results = linkSkills(dir, true);
    assert.ok(results.every((r) => r.action === "linked"));
    for (const r of results) {
      assert.ok(
        !existsSync(join(dir, r.name)),
        `${r.name} must not be created`,
      );
    }
    console.log("  ✓ linkSkills --dry-run creates nothing");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// --- opencode platform tests ---

function opencodeEntry(): Record<string, unknown> {
  return {
    type: "local",
    command: ["bun", "run", "fapony.ts", "mcp"],
  };
}

export function testInstallOpencodeNewFile(): void {
  withTempHome((home) => {
    const err = silentErrors(() =>
      captureErrors(() =>
        cmdInstallOpencode(false, { exit: testExit, homedir: () => home }),
      ),
    );
    const targetPath = join(home, ".config", "opencode", "opencode.json");
    assert.ok(existsSync(targetPath), "opencode.json should be created");
    const cfg = JSON.parse(readFileSync(targetPath, "utf-8")) as Record<
      string,
      unknown
    >;
    assert.deepStrictEqual(
      (cfg.mcp as Record<string, unknown>).fapony,
      opencodeEntry(),
    );
    assert.ok(err.includes("created"), `got: ${err}`);
    console.log("  ✓ install opencode no config → creates opencode.json");
  });
}

export function testInstallOpencodeAlreadyConfiguredNoOp(): void {
  withTempHome((home) => {
    const configDir = join(home, ".config", "opencode");
    mkdirSync(configDir, { recursive: true });
    const configPath = join(configDir, "opencode.json");
    writeJson(configPath, { mcp: { fapony: opencodeEntry() } });

    const before = readFileSync(configPath, "utf-8");
    const err = silentErrors(() =>
      captureErrors(() =>
        cmdInstallOpencode(false, { exit: testExit, homedir: () => home }),
      ),
    );
    const after = readFileSync(configPath, "utf-8");
    assert.equal(before, after);
    assert.ok(err.includes("already configured"), `got: ${err}`);
    console.log("  ✓ install opencode already configured → no-op");
  });
}

export function testInstallOpencodeDryRunNoWrite(): void {
  withTempHome((home) => {
    const configDir = join(home, ".config", "opencode");
    mkdirSync(configDir, { recursive: true });
    const configPath = join(configDir, "opencode.json");
    writeJson(configPath, {});

    const before = readFileSync(configPath, "utf-8");
    const err = silentErrors(() =>
      captureErrors(() =>
        cmdInstallOpencode(true, { exit: testExit, homedir: () => home }),
      ),
    );
    const after = readFileSync(configPath, "utf-8");
    assert.equal(before, after);
    assert.ok(err.includes("dry-run"), `got: ${err}`);
    assert.ok(err.includes("mcp.fapony"), `got: ${err}`);
    console.log("  ✓ install opencode dry-run → no write");
  });
}

export function testInstallOpencodeParseErrorFails(): void {
  withTempHome((home) => {
    const configDir = join(home, ".config", "opencode");
    mkdirSync(configDir, { recursive: true });
    const configPath = join(configDir, "opencode.json");
    writeFileSync(configPath, "{ not json\n");

    let code: number | null = null;
    const err = silentErrors(() =>
      captureErrors(() => {
        try {
          cmdInstallOpencode(false, { exit: testExit, homedir: () => home });
        } catch (e) {
          code = (e as TestExit).code;
        }
      }),
    );
    assert.equal(code, 1);
    assert.ok(err.includes("failed to parse"), `got: ${err}`);
    console.log("  ✓ install opencode broken config → clear error");
  });
}

export function testCmdInstallDispatchesOpencode(): void {
  withTempHome((home) => {
    silentErrors(() =>
      cmdInstall(["opencode"], { exit: testExit, homedir: () => home }),
    );
    const targetPath = join(home, ".config", "opencode", "opencode.json");
    const cfg = JSON.parse(readFileSync(targetPath, "utf-8")) as Record<
      string,
      unknown
    >;
    assert.deepStrictEqual(
      (cfg.mcp as Record<string, unknown>).fapony,
      opencodeEntry(),
    );
    console.log("  ✓ install dispatch routes --platform opencode");
  });
}

// --- codex platform tests ---

function codexEntryToml(): string {
  return `[mcp_servers.fapony]
command = "bun"
args = ["run", "${join(INSTALL_ROOT, "fapony.ts")}", "mcp"]
type = "stdio"
`;
}

export function testInstallCodexNoConfigFails(): void {
  withTempHome((home) => {
    let code: number | null = null;
    const err = silentErrors(() =>
      captureErrors(() => {
        try {
          cmdInstallCodex(false, { exit: testExit, homedir: () => home });
        } catch (e) {
          code = (e as TestExit).code;
        }
      }),
    );
    assert.equal(code, 1);
    assert.ok(err.includes("Codex config not found"), `got: ${err}`);
    console.log("  ✓ install codex no config → clear error");
  });
}

export function testInstallCodexAppendsEntry(): void {
  withTempHome((home) => {
    const configDir = join(home, ".codex");
    mkdirSync(configDir, { recursive: true });
    const configPath = join(configDir, "config.toml");
    writeFileSync(configPath, 'model = "gpt-5"\n');

    const err = silentErrors(() =>
      captureErrors(() =>
        cmdInstallCodex(false, { exit: testExit, homedir: () => home }),
      ),
    );
    const after = readFileSync(configPath, "utf-8");
    assert.ok(after.includes("[mcp_servers.fapony]"), `got: ${after}`);
    assert.ok(after.includes('model = "gpt-5"'), `got: ${after}`);
    assert.ok(err.includes("added mcp_servers.fapony"), `got: ${err}`);
    console.log("  ✓ install codex existing config → appends entry");
  });
}

export function testInstallCodexAlreadyConfiguredNoOp(): void {
  withTempHome((home) => {
    const configDir = join(home, ".codex");
    mkdirSync(configDir, { recursive: true });
    const configPath = join(configDir, "config.toml");
    writeFileSync(configPath, codexEntryToml());

    const before = readFileSync(configPath, "utf-8");
    const err = silentErrors(() =>
      captureErrors(() =>
        cmdInstallCodex(false, { exit: testExit, homedir: () => home }),
      ),
    );
    const after = readFileSync(configPath, "utf-8");
    assert.equal(before, after);
    assert.ok(err.includes("already configured"), `got: ${err}`);
    console.log("  ✓ install codex already configured → no-op");
  });
}

export function testInstallCodexDryRunNoWrite(): void {
  withTempHome((home) => {
    const configDir = join(home, ".codex");
    mkdirSync(configDir, { recursive: true });
    const configPath = join(configDir, "config.toml");
    writeFileSync(configPath, 'model = "gpt-5"\n');

    const before = readFileSync(configPath, "utf-8");
    const err = silentErrors(() =>
      captureErrors(() =>
        cmdInstallCodex(true, { exit: testExit, homedir: () => home }),
      ),
    );
    const after = readFileSync(configPath, "utf-8");
    assert.equal(before, after);
    assert.ok(err.includes("dry-run"), `got: ${err}`);
    console.log("  ✓ install codex dry-run → no write");
  });
}

export function testCmdInstallDispatchesCodex(): void {
  withTempHome((home) => {
    const configDir = join(home, ".codex");
    mkdirSync(configDir, { recursive: true });
    const configPath = join(configDir, "config.toml");
    writeFileSync(configPath, 'model = "gpt-5"\n');

    silentErrors(() =>
      cmdInstall(["codex"], { exit: testExit, homedir: () => home }),
    );
    const after = readFileSync(configPath, "utf-8");
    assert.ok(after.includes("[mcp_servers.fapony]"), `got: ${after}`);
    console.log("  ✓ install dispatch routes --platform codex");
  });
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

// --- detect + prompt tests ---

export function testDetectClientsAllFound(): void {
  const home = mkdtempSync(join(tmpdir(), "fapony-detect-all-"));
  try {
    // claude: checkCmd returns true
    // opencode: config exists
    const ocDir = join(home, ".config", "opencode");
    mkdirSync(ocDir, { recursive: true });
    writeFileSync(join(ocDir, "opencode.json"), "{}");
    // zcode: config exists
    const zcDir = join(home, ".zcode", "cli");
    mkdirSync(zcDir, { recursive: true });
    writeFileSync(join(zcDir, "config.json"), "{}");
    // codex: config exists
    const cdDir = join(home, ".codex");
    mkdirSync(cdDir, { recursive: true });
    writeFileSync(join(cdDir, "config.toml"), "");

    const deps: InstallDeps = {
      homedir: () => home,
      checkCmd: () => true,
    };
    const result = detectClients(deps);
    assert.equal(result.length, 4);
    assert.ok(
      result.every((d) => d.installed),
      "all should be installed",
    );
    console.log("  ✓ detect clients → all found");
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
}

export function testDetectClientsNoneFound(): void {
  const home = mkdtempSync(join(tmpdir(), "fapony-detect-none-"));
  try {
    const deps: InstallDeps = {
      homedir: () => home,
      checkCmd: () => false,
    };
    const result = detectClients(deps);
    assert.equal(result.length, 4);
    assert.ok(
      result.every((d) => !d.installed),
      "none should be installed",
    );
    assert.ok(result.every((d) => d.platform.length > 0));
    console.log("  ✓ detect clients → none found");
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
}

export function testDetectClientsMixed(): void {
  const home = mkdtempSync(join(tmpdir(), "fapony-detect-mixed-"));
  try {
    // Only opencode config exists
    const ocDir = join(home, ".config", "opencode");
    mkdirSync(ocDir, { recursive: true });
    writeFileSync(join(ocDir, "opencode.json"), "{}");

    const deps: InstallDeps = {
      homedir: () => home,
      checkCmd: () => false, // claude not on PATH
    };
    const result = detectClients(deps);
    const opencode = result.find((d) => d.platform === "opencode");
    const claude = result.find((d) => d.platform === "claude");
    assert.ok(opencode?.installed, "opencode should be found");
    assert.ok(!claude?.installed, "claude should not be found");
    console.log("  ✓ detect clients → mixed");
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
}

export async function testCmdInstallNoPlatformPromptsDetected(): Promise<void> {
  const home = mkdtempSync(join(tmpdir(), "fapony-install-prompt-"));
  try {
    // Set up opencode config so it's detected
    const ocDir = join(home, ".config", "opencode");
    mkdirSync(ocDir, { recursive: true });
    writeFileSync(join(ocDir, "opencode.json"), "{}");

    const asked: string[] = [];
    const deps: InstallDeps = {
      homedir: () => home,
      checkCmd: () => false, // claude not found
      ask: async (q: string) => {
        asked.push(q);
        return "n"; // decline all
      },
    };

    // Mock stdin.isTTY — but we can't easily mock that.
    // Instead, just test that without --all and with ask returning "n",
    // no install function is called (opencode config unchanged).
    const origIsTTY = process.stdin.isTTY;
    Object.defineProperty(process.stdin, "isTTY", {
      value: true,
      configurable: true,
    });
    try {
      await cmdInstall([], deps);
    } finally {
      Object.defineProperty(process.stdin, "isTTY", {
        value: origIsTTY,
        configurable: true,
      });
    }

    // ask was called for opencode (only detected client)
    assert.ok(
      asked.length >= 1,
      `should have asked at least once, got ${asked.length}`,
    );
    assert.ok(
      asked.some((q) => q.includes("opencode")),
      "should ask about opencode",
    );
    // Config should still be empty (not modified) since we answered "n"
    const cfg = JSON.parse(readFileSync(join(ocDir, "opencode.json"), "utf-8"));
    assert.deepStrictEqual(
      cfg,
      {},
      "opencode config should not be modified when declined",
    );
    console.log(
      "  ✓ install no platform → prompts detected, declines no install",
    );
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
}

export async function testCmdInstallNonTtyNoAllSkipsInstall(): Promise<void> {
  const home = mkdtempSync(join(tmpdir(), "fapony-install-nontty-"));
  try {
    const ocDir = join(home, ".config", "opencode");
    mkdirSync(ocDir, { recursive: true });
    writeFileSync(join(ocDir, "opencode.json"), "{}");

    const lines: string[] = [];
    const origError = console.error;
    console.error = (...a: unknown[]) => {
      lines.push(a.map(String).join(" "));
    };
    const deps: InstallDeps = {
      homedir: () => home,
      checkCmd: () => false,
    };
    const origIsTTY = process.stdin.isTTY;
    Object.defineProperty(process.stdin, "isTTY", {
      value: false,
      configurable: true,
    });
    try {
      await cmdInstall([], deps);
    } finally {
      Object.defineProperty(process.stdin, "isTTY", {
        value: origIsTTY,
        configurable: true,
      });
      console.error = origError;
    }

    const output = lines.join("\n");
    assert.ok(
      output.includes("not a terminal"),
      `should mention non-terminal: ${output}`,
    );
    // Config must remain untouched — no install happened.
    const cfg = JSON.parse(readFileSync(join(ocDir, "opencode.json"), "utf-8"));
    assert.deepStrictEqual(
      cfg,
      {},
      "non-TTY without --all must not modify config",
    );
    console.log(
      "  ✓ install non-TTY without --all → skips install, hints --all",
    );
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
}

export async function testCmdInstallNoPlatformAllFlag(): Promise<void> {
  const home = mkdtempSync(join(tmpdir(), "fapony-install-all-"));
  try {
    // Set up opencode config
    const ocDir = join(home, ".config", "opencode");
    mkdirSync(ocDir, { recursive: true });
    writeFileSync(join(ocDir, "opencode.json"), "{}");

    const deps: InstallDeps = {
      homedir: () => home,
      checkCmd: () => false, // claude not found
    };

    const origIsTTY = process.stdin.isTTY;
    Object.defineProperty(process.stdin, "isTTY", {
      value: true,
      configurable: true,
    });
    try {
      await cmdInstall(["--all"], deps);
    } finally {
      Object.defineProperty(process.stdin, "isTTY", {
        value: origIsTTY,
        configurable: true,
      });
    }

    // opencode config should now have mcp.fapony
    const cfg = JSON.parse(readFileSync(join(ocDir, "opencode.json"), "utf-8"));
    assert.ok(cfg.mcp, "opencode config should have mcp section");
    assert.ok(
      (cfg.mcp as Record<string, unknown>).fapony,
      "should have fapony entry",
    );
    console.log("  ✓ install --all → installs all detected without prompting");
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
}

export function testCmdInstallNoClientsFoundPrintsHelp(): void {
  const home = mkdtempSync(join(tmpdir(), "fapony-install-noclients-"));
  try {
    const lines: string[] = [];
    const orig = console.error;
    console.error = (...a: unknown[]) => {
      lines.push(a.map(String).join(" "));
    };
    const deps: InstallDeps = {
      homedir: () => home,
      checkCmd: () => false,
    };
    try {
      cmdInstall([], deps);
    } finally {
      console.error = orig;
    }

    const output = lines.join("\n");
    assert.ok(
      output.includes("no MCP client found"),
      `should say no client found: ${output}`,
    );
    assert.ok(
      output.includes("--platform"),
      `should hint --platform: ${output}`,
    );
    console.log("  ✓ install no clients → prints help message");
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
}

export async function testCmdInstallNoPlatformDryRunNoWrite(): Promise<void> {
  const home = mkdtempSync(join(tmpdir(), "fapony-install-dry-"));
  try {
    // Set up opencode config
    const ocDir = join(home, ".config", "opencode");
    mkdirSync(ocDir, { recursive: true });
    writeFileSync(join(ocDir, "opencode.json"), "{}");

    const deps: InstallDeps = {
      homedir: () => home,
      checkCmd: () => false,
      ask: async () => "y",
    };

    const origIsTTY = process.stdin.isTTY;
    Object.defineProperty(process.stdin, "isTTY", {
      value: true,
      configurable: true,
    });
    try {
      await cmdInstall(["--all", "--dry-run"], deps);
    } finally {
      Object.defineProperty(process.stdin, "isTTY", {
        value: origIsTTY,
        configurable: true,
      });
    }

    // Config should NOT be modified (dry run)
    const cfg = JSON.parse(readFileSync(join(ocDir, "opencode.json"), "utf-8"));
    assert.deepStrictEqual(cfg, {}, "dry-run should not write opencode config");
    console.log("  ✓ install --all --dry-run → no file writes");
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
}
