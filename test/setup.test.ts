import assert from "node:assert";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  buildSetupConfig,
  cmdSetup,
  shouldOverwriteConfig,
  validateWorktreePath,
} from "../src/setup.js";

export function testBuildSetupConfigNoMemory(): void {
  const config = buildSetupConfig({
    worktreeName: "myapp",
    worktreePath: "/tmp/myapp",
    enableMemory: false,
  });
  assert.deepStrictEqual(config.worktrees, { myapp: "/tmp/myapp" });
  assert.deepStrictEqual(config.review, { maxRounds: 2 });
  assert.equal(config.memory, null);
  console.log("  ✓ buildSetupConfig without memory");
}

export function testBuildSetupConfigWithMemory(): void {
  const config = buildSetupConfig({
    worktreeName: "myapp",
    worktreePath: "/tmp/myapp",
    enableMemory: true,
  });
  const mem = config.memory as Record<string, string[]>;
  assert.deepStrictEqual(mem.claim, ["fapony", "mem", "claim", "{id}"]);
  assert.deepStrictEqual(mem.close, [
    "fapony",
    "mem",
    "close",
    "{id}",
    "{msg}",
  ]);
  assert.deepStrictEqual(mem.add, ["fapony", "mem", "add", "{kind}", "{text}"]);
  assert.deepStrictEqual(mem.kickoff, ["fapony", "mem", "kickoff"]);
  console.log("  ✓ buildSetupConfig with memory");
}

export function testValidateWorktreePath(): void {
  const dir = mkdtempSync(join(tmpdir(), "fapony-setup-test-"));
  assert.equal(validateWorktreePath(dir), null);
  const missing = validateWorktreePath(join(dir, "nope"));
  assert.ok(missing?.includes("does not exist"), `got: ${missing}`);
  const empty = validateWorktreePath("");
  assert.ok(empty !== null, "empty path must fail validation");
  console.log("  ✓ validateWorktreePath");
}

export function testValidateWorktreePathRejectsFile(): void {
  const dir = mkdtempSync(join(tmpdir(), "fapony-setup-test-"));
  const file = join(dir, "not-a-dir");
  writeFileSync(file, "x\n");
  const err = validateWorktreePath(file);
  assert.ok(err?.includes("not a directory"), `got: ${err}`);
  console.log("  ✓ validateWorktreePath rejects file");
}

export function testShouldOverwriteConfig(): void {
  assert.equal(shouldOverwriteConfig("y"), true);
  assert.equal(shouldOverwriteConfig("yes"), true);
  assert.equal(shouldOverwriteConfig("Y"), true);
  assert.equal(shouldOverwriteConfig("  yes  "), true);
  assert.equal(shouldOverwriteConfig("n"), false);
  assert.equal(shouldOverwriteConfig("no"), false);
  assert.equal(shouldOverwriteConfig(""), false);
  console.log("  ✓ shouldOverwriteConfig");
}

// --- cmdSetup orchestration (seam-based; fs/cwd stay real on temp dirs) ---

class SetupTestExit extends Error {
  code: number;
  constructor(code: number) {
    super(`exit:${code}`);
    this.code = code;
  }
}

function setupTestExit(code: number): never {
  throw new SetupTestExit(code);
}

async function captureSetupOutput(fn: () => Promise<void>): Promise<{
  out: string;
  err: string;
}> {
  const origLog = console.log;
  const origErr = console.error;
  let out = "";
  let err = "";
  console.log = (...a: unknown[]): void => {
    out += `${a.join(" ")}\n`;
  };
  console.error = (...a: unknown[]): void => {
    err += `${a.join(" ")}\n`;
  };
  try {
    await fn();
  } finally {
    console.log = origLog;
    console.error = origErr;
  }
  return { out, err };
}

/** Queue-based fake ask — answers must follow the real question order:
 *  path, name, memory, [overwrite]. */
function queueAsk(answers: string[]): {
  ask: (q: string, def?: string) => Promise<string>;
  questions: string[];
} {
  const questions: string[] = [];
  const queue = [...answers];
  const ask = async (q: string, _def?: string): Promise<string> => {
    questions.push(q);
    const next = queue.shift();
    assert.ok(next !== undefined, `unexpected extra question: ${q}`);
    return next;
  };
  return { ask, questions };
}

function mapCheckCmd(present: Record<string, boolean>): {
  checkCmd: (cmd: string) => boolean;
} {
  return { checkCmd: (cmd: string) => present[cmd] ?? false };
}

/** Run fn with cwd pointed at a fresh temp dir (so fapony.config.json
 *  writes never touch the repo root); always restores cwd. */
async function withTempCwd<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = mkdtempSync(join(tmpdir(), "fapony-setup-cwd-"));
  const saved = process.cwd();
  process.chdir(dir);
  try {
    return await fn(dir);
  } finally {
    process.chdir(saved);
  }
}

const SETUP_ANSWERS = (worktreePath: string): string[] => [
  worktreePath,
  "myapp",
  "n",
];

export async function testCmdSetupGitMissing(): Promise<void> {
  const { checkCmd } = mapCheckCmd({});
  const { ask } = queueAsk([]);
  let code: number | null = null;
  const { err } = await captureSetupOutput(async () => {
    try {
      await cmdSetup({ checkCmd, ask, exit: setupTestExit });
    } catch (e) {
      code = (e as SetupTestExit).code;
    }
  });
  assert.equal(code, 1);
  assert.ok(err.includes("git is required"), `got: ${err}`);
  console.log("  ✓ cmdSetup git missing exit");
}

export async function testCmdSetupBunMissing(): Promise<void> {
  const { checkCmd } = mapCheckCmd({ git: true });
  const { ask } = queueAsk([]);
  let code: number | null = null;
  const { err } = await captureSetupOutput(async () => {
    try {
      await cmdSetup({ checkCmd, ask, exit: setupTestExit });
    } catch (e) {
      code = (e as SetupTestExit).code;
    }
  });
  assert.equal(code, 1);
  assert.ok(err.includes("bun is required"), `got: ${err}`);
  console.log("  ✓ cmdSetup bun missing exit");
}

export async function testCmdSetupInvalidPath(): Promise<void> {
  const { checkCmd } = mapCheckCmd({ git: true, bun: true });
  const { ask } = queueAsk([join(tmpdir(), "fapony-setup-nope-404")]);
  let code: number | null = null;
  const { err } = await captureSetupOutput(async () => {
    try {
      await cmdSetup({
        checkCmd,
        ask,
        detectGitRoot: () => null,
        exit: setupTestExit,
      });
    } catch (e) {
      code = (e as SetupTestExit).code;
    }
  });
  assert.equal(code, 1);
  assert.ok(err.includes("does not exist"), `got: ${err}`);
  console.log("  ✓ cmdSetup invalid path exit");
}

export async function testCmdSetupOverwriteNoKeepsFile(): Promise<void> {
  await withTempCwd(async (cwd) => {
    const sentinel = JSON.stringify({ sentinel: true });
    writeFileSync(join(cwd, "fapony.config.json"), `${sentinel}\n`);
    const worktree = mkdtempSync(join(tmpdir(), "fapony-setup-wt-"));
    const { checkCmd } = mapCheckCmd({
      git: true,
      bun: true,
      opencode: true,
      claude: true,
    });
    const { ask } = queueAsk([...SETUP_ANSWERS(worktree), "n"]);
    const { out } = await captureSetupOutput(async () => {
      await cmdSetup({
        checkCmd,
        ask,
        detectGitRoot: () => worktree,
        exit: setupTestExit,
      });
    });
    assert.ok(out.includes("Skipped config write"), `got: ${out}`);
    assert.equal(
      readFileSync(join(cwd, "fapony.config.json"), "utf-8").trim(),
      sentinel,
    );
    assert.equal(existsSync(join(worktree, ".fapony")), false);
  });
  console.log("  ✓ cmdSetup overwrite-n keeps file");
}

export async function testCmdSetupOverwriteYesWritesThrough(): Promise<void> {
  await withTempCwd(async (cwd) => {
    writeFileSync(join(cwd, "fapony.config.json"), '{"sentinel":true}\n');
    const worktree = mkdtempSync(join(tmpdir(), "fapony-setup-wt-"));
    const { checkCmd } = mapCheckCmd({
      git: true,
      bun: true,
      opencode: true,
      claude: true,
    });
    const { ask, questions } = queueAsk([...SETUP_ANSWERS(worktree), "y"]);
    const { out } = await captureSetupOutput(async () => {
      await cmdSetup({
        checkCmd,
        ask,
        detectGitRoot: () => worktree,
        exit: setupTestExit,
      });
    });
    assert.ok(out.includes("Wrote"), `got: ${out}`);
    assert.ok(
      questions[questions.length - 1].includes("Overwrite"),
      `got: ${questions.join(" | ")}`,
    );
    const written = JSON.parse(
      readFileSync(join(cwd, "fapony.config.json"), "utf-8"),
    ) as { worktrees: Record<string, string> };
    assert.equal(written.worktrees.myapp, worktree);
    assert.equal(existsSync(join(worktree, ".fapony")), true);
  });
  console.log("  ✓ cmdSetup overwrite-y writes through");
}

export async function testCmdSetupHappyPathScaffolds(): Promise<void> {
  await withTempCwd(async (cwd) => {
    const worktree = mkdtempSync(join(tmpdir(), "fapony-setup-wt-"));
    const { checkCmd } = mapCheckCmd({
      git: true,
      bun: true,
      opencode: false,
      claude: false,
    });
    const { ask, questions } = queueAsk(SETUP_ANSWERS(worktree));
    const { out } = await captureSetupOutput(async () => {
      await cmdSetup({
        checkCmd,
        ask,
        detectGitRoot: () => worktree,
        exit: setupTestExit,
      });
    });
    assert.deepStrictEqual(questions, [
      "Worktree path",
      "Worktree name (key for CLI)",
      "Enable project memory? (y/n)",
    ]);
    const written = JSON.parse(
      readFileSync(join(cwd, "fapony.config.json"), "utf-8"),
    ) as { worktrees: Record<string, string> };
    assert.equal(written.worktrees.myapp, worktree);
    assert.equal(existsSync(join(worktree, ".fapony", "plan")), true);
    assert.ok(out.includes("Setup complete"), `got tail: ${out.slice(-200)}`);
  });
  console.log("  ✓ cmdSetup happy path scaffolds");
}

export async function testCmdSetupScaffoldAlreadyExists(): Promise<void> {
  await withTempCwd(async (cwd) => {
    const worktree = mkdtempSync(join(tmpdir(), "fapony-setup-wt-"));
    mkdirSync(join(worktree, ".fapony"), { recursive: true });
    const { checkCmd } = mapCheckCmd({ git: true, bun: true });
    const { ask } = queueAsk(SETUP_ANSWERS(worktree));
    const { out } = await captureSetupOutput(async () => {
      await cmdSetup({
        checkCmd,
        ask,
        detectGitRoot: () => worktree,
        exit: setupTestExit,
      });
    });
    assert.ok(out.includes("already exists"), `got: ${out}`);
    assert.equal(existsSync(join(cwd, "fapony.config.json")), true);
  });
  console.log("  ✓ cmdSetup scaffold already-exists");
}
