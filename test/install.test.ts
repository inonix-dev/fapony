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
  const after = readFileSync(join(claudeDir, "settings.json"), "utf-8");
  assert.equal(after, before, "foreign statusLine must not be overwritten");
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

export function testCmdInstallDispatchesClaude(): void {
  // cmdInstall routes --platform claude through the same seam (3rd case:
  // dispatch itself, alongside absent/present/different above).
  const ADD = claudeAddArgs().join(" ");
  const { run, calls } = mapRun({ [GET]: ABSENT, [ADD]: ADDED });
  const deps: InstallDeps = { run, exit: testExit };
  silentErrors(() => cmdInstall(["install", "claude"].slice(1), deps));
  assert.deepStrictEqual(calls, [GET, ADD]);
  console.log("  ✓ install dispatch routes --platform claude");
}

export function testCmdInstallRejectsUnknownPlatform(): void {
  let code: number | null = null;
  const err = silentErrors(() =>
    captureErrors(() => {
      try {
        cmdInstall(["windows"], { exit: testExit });
      } catch (e) {
        code = (e as TestExit).code;
      }
    }),
  );
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
