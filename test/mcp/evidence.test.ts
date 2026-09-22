// test/mcp/evidence.test.ts — tests for evidence collector

import assert from "node:assert";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  collectEvidence,
  readEvidenceConfig,
  resolveEvidencePath,
} from "../../src/adapters/mcp/evidence.js";

function makeTmpWorktree(): string {
  const dir = mkdtempSync(join(tmpdir(), "fapony-evidence-"));
  mkdirSync(join(dir, ".fapony"), { recursive: true });
  return dir;
}

// --- readEvidenceConfig ---

export function testReadEvidenceConfigMissing(): void {
  const dir = makeTmpWorktree();
  try {
    const config = readEvidenceConfig(dir);
    assert.equal(config, null);
    console.log("  ✓ readEvidenceConfig returns null when file missing");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

export function testReadEvidenceConfigInvalid(): void {
  const dir = makeTmpWorktree();
  try {
    writeFileSync(join(dir, ".fapony/evidence.json"), "not json");
    const config = readEvidenceConfig(dir);
    assert.equal(config, null);
    console.log("  ✓ readEvidenceConfig returns null on invalid JSON");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

export function testReadEvidenceConfigValid(): void {
  const dir = makeTmpWorktree();
  try {
    writeFileSync(
      join(dir, ".fapony/evidence.json"),
      JSON.stringify({
        commands: [{ name: "test", cmd: "echo ok", timeout_ms: 5000 }],
      }),
    );
    const config = readEvidenceConfig(dir);
    assert.ok(config);
    assert.equal(config.commands.length, 1);
    assert.equal(config.commands[0].cmd, "echo ok");
    assert.equal(config.commands[0].timeout_ms, 5000);
    console.log("  ✓ readEvidenceConfig parses valid config");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

export function testReadEvidenceConfigCustomPath(): void {
  const dir = makeTmpWorktree();
  try {
    mkdirSync(join(dir, "config"), { recursive: true });
    writeFileSync(
      join(dir, "config/evidence.json"),
      JSON.stringify({
        commands: [{ name: "test", cmd: "echo ok", timeout_ms: 5000 }],
      }),
    );
    // Default path absent — without config, nothing is found…
    assert.equal(readEvidenceConfig(dir), null);
    // …with paths.evidenceFile, the custom location is read…
    const found = readEvidenceConfig(dir, {
      worktrees: {},
      review: { maxRounds: 2 },
      memory: null,
      paths: { evidenceFile: "config/evidence.json" },
    });
    assert.ok(found);
    assert.equal(found.commands[0].cmd, "echo ok");
    // …and collectEvidence runs it.
    const items = collectEvidence({
      worktree: dir,
      config: {
        worktrees: {},
        review: { maxRounds: 2 },
        memory: null,
        paths: { evidenceFile: "config/evidence.json" },
      },
    });
    assert.equal(items.length, 1);
    assert.equal(items[0].status, "passed");
    console.log("  ✓ readEvidenceConfig honours paths.evidenceFile");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// --- collectEvidence ---

export function testCollectEvidenceNoConfig(): void {
  const dir = makeTmpWorktree();
  try {
    const items = collectEvidence({ worktree: dir });
    assert.equal(items.length, 0);
    console.log("  ✓ collectEvidence returns empty when no config");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

export function testCollectEvidencePassingCommand(): void {
  const dir = makeTmpWorktree();
  try {
    writeFileSync(
      join(dir, ".fapony/evidence.json"),
      JSON.stringify({
        commands: [{ name: "echo", cmd: "echo ok", timeout_ms: 5000 }],
      }),
    );
    const items = collectEvidence({ worktree: dir });
    assert.equal(items.length, 1);
    assert.equal(items[0].status, "passed");
    assert.equal(items[0].exit_code, 0);
    assert.equal(items[0].provenance.verified, true);
    assert.equal(items[0].provenance.source, "fapony_cli");
    assert.ok(items[0].duration_ms !== null);
    console.log("  ✓ collectEvidence runs passing command");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

export function testCollectEvidenceFailingCommand(): void {
  const dir = makeTmpWorktree();
  try {
    writeFileSync(
      join(dir, ".fapony/evidence.json"),
      JSON.stringify({
        commands: [{ name: "fail", cmd: "exit 1", timeout_ms: 5000 }],
      }),
    );
    const items = collectEvidence({ worktree: dir });
    assert.equal(items.length, 1);
    assert.equal(items[0].status, "failed");
    assert.equal(items[0].exit_code, 1);
    console.log("  ✓ collectEvidence detects failing command");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

export function testCollectEvidenceAgentCommands(): void {
  const dir = makeTmpWorktree();
  try {
    // Agent-proposed commands are recorded as unverified claims — NEVER run.
    // Proof of non-execution: a side-effect command must leave no trace.
    const sentinel = join(dir, "agent-should-not-touch.txt");
    const items = collectEvidence({
      worktree: dir,
      agentCommands: ["echo agent", `touch ${sentinel}`],
    });
    assert.equal(items.length, 2);
    for (const item of items) {
      assert.equal(item.status, "unverified");
      assert.equal(item.exit_code, null);
      assert.equal(item.duration_ms, null);
      assert.equal(item.provenance.verified, false);
      assert.equal(item.provenance.source, "agent_report");
    }
    assert.equal(
      existsSync(sentinel),
      false,
      "agent command must not be executed",
    );
    console.log(
      "  ✓ collectEvidence records agent commands unverified, never runs them",
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

export function testCollectEvidenceAgentDuplicatesAllowlist(): void {
  const dir = makeTmpWorktree();
  try {
    writeFileSync(
      join(dir, ".fapony/evidence.json"),
      JSON.stringify({
        commands: [{ name: "test", cmd: "echo ok", timeout_ms: 5000 }],
      }),
    );
    // Agent proposes same command — should be skipped
    const items = collectEvidence({
      worktree: dir,
      agentCommands: ["echo ok"],
    });
    assert.equal(items.length, 1);
    assert.equal(items[0].provenance.source, "fapony_cli");
    console.log("  ✓ collectEvidence skips agent cmd already in allowlist");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

export function testCollectEvidenceTimeout(): void {
  const dir = makeTmpWorktree();
  try {
    writeFileSync(
      join(dir, ".fapony/evidence.json"),
      JSON.stringify({
        commands: [{ name: "slow", cmd: "sleep 5", timeout_ms: 200 }],
      }),
    );
    const items = collectEvidence({ worktree: dir });
    assert.equal(items.length, 1);
    assert.equal(items[0].status, "timeout");
    assert.equal(items[0].exit_code, null);
    assert.ok(
      items[0].note?.startsWith("exceeded"),
      `note should report exceeded timeout, got: ${items[0].note}`,
    );
    console.log(
      "  ✓ collectEvidence reports signal-killed commands as timeout",
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

export function testCollectEvidenceRefusesDangerousCommand(): void {
  const dir = makeTmpWorktree();
  try {
    // Even allowlisted commands go through assertSafe (rule #4) — the file
    // lives in agent-reachable worktree.
    writeFileSync(
      join(dir, ".fapony/evidence.json"),
      JSON.stringify({
        commands: [{ name: "nuke", cmd: "git reset --hard HEAD" }],
      }),
    );
    const items = collectEvidence({ worktree: dir });
    assert.equal(items.length, 1);
    assert.equal(items[0].status, "failed");
    assert.equal(items[0].exit_code, null);
    assert.ok(
      items[0].note?.includes("refusing"),
      `note should carry the refusal, got: ${items[0].note}`,
    );
    console.log(
      "  ✓ collectEvidence refuses deny-listed commands without running",
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

export function testCollectEvidenceInvalidEntry(): void {
  const dir = makeTmpWorktree();
  try {
    writeFileSync(
      join(dir, ".fapony/evidence.json"),
      JSON.stringify({ commands: [{ name: "broken", cmd: 123 }] }),
    );
    const items = collectEvidence({ worktree: dir });
    assert.equal(items.length, 1);
    assert.equal(items[0].status, "not_run");
    assert.ok(
      items[0].note?.includes("invalid entry"),
      `note should flag the config error, got: ${items[0].note}`,
    );
    console.log(
      "  ✓ collectEvidence flags invalid allowlist entries as not_run",
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// --- App-scoped resolution ---

// Monorepo fixture: apps/a and apps/b with different allowlists + a root fallback.
function makeAppWorktree(): string {
  const dir = mkdtempSync(join(tmpdir(), "fapony-evidence-app-"));
  for (const [app, cmd] of [
    ["a", "echo a-ok"],
    ["b", "echo b-ok"],
  ] as const) {
    mkdirSync(join(dir, `apps/${app}/.fapony`), { recursive: true });
    writeFileSync(
      join(dir, `apps/${app}/.fapony/evidence.json`),
      JSON.stringify({ commands: [{ name: "test", cmd, timeout_ms: 5000 }] }),
    );
  }
  mkdirSync(join(dir, ".fapony"), { recursive: true });
  writeFileSync(
    join(dir, ".fapony/evidence.json"),
    JSON.stringify({
      commands: [{ name: "test", cmd: "echo root-ok", timeout_ms: 5000 }],
    }),
  );
  return dir;
}

export function testResolveEvidencePathAppScoped(): void {
  const dir = makeAppWorktree();
  try {
    assert.equal(
      resolveEvidencePath(dir, ["apps/b/src/x.ts", "apps/b/test/x.test.ts"]),
      join(dir, "apps/b/.fapony/evidence.json"),
    );
    console.log("  ✓ resolveEvidencePath picks the app allowlist");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

export function testResolveEvidencePathMixedFallsBackToRoot(): void {
  const dir = makeAppWorktree();
  try {
    assert.equal(
      resolveEvidencePath(dir, ["apps/a/a.ts", "apps/b/b.ts"]),
      join(dir, ".fapony/evidence.json"),
    );
    console.log("  ✓ resolveEvidencePath falls back to root on mixed apps");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

export function testResolveEvidencePathEmptyFallsBackToRoot(): void {
  const dir = makeAppWorktree();
  try {
    assert.equal(
      resolveEvidencePath(dir, []),
      join(dir, ".fapony/evidence.json"),
    );
    assert.equal(resolveEvidencePath(dir), join(dir, ".fapony/evidence.json"));
    console.log("  ✓ resolveEvidencePath falls back to root without files[]");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

export function testResolveEvidencePathMissingAppFileFallsBackToRoot(): void {
  const dir = makeAppWorktree();
  try {
    mkdirSync(join(dir, "apps/c/src"), { recursive: true });
    assert.equal(
      resolveEvidencePath(dir, ["apps/c/src/y.ts"]),
      join(dir, ".fapony/evidence.json"),
    );
    console.log(
      "  ✓ resolveEvidencePath falls back to root when the app has no allowlist",
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

export function testResolveEvidencePathCustomConfigWins(): void {
  const dir = makeAppWorktree();
  try {
    mkdirSync(join(dir, "config"), { recursive: true });
    writeFileSync(
      join(dir, "config/evidence.json"),
      JSON.stringify({
        commands: [{ name: "test", cmd: "echo custom-ok", timeout_ms: 5000 }],
      }),
    );
    const config = {
      worktrees: {},
      review: { maxRounds: 2 },
      memory: null,
      paths: { evidenceFile: "config/evidence.json" },
    };
    assert.equal(
      resolveEvidencePath(dir, ["apps/b/src/x.ts"], config),
      join(dir, "config/evidence.json"),
    );
    console.log(
      "  ✓ resolveEvidencePath honours a declared paths.evidenceFile",
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

export function testCollectEvidenceAppScoped(): void {
  const dir = makeAppWorktree();
  try {
    // Report touching only apps/b must run b's allowlist, not a's or root's.
    const items = collectEvidence({
      worktree: dir,
      files: ["apps/b/src/x.ts", "apps/b/test/x.test.ts"],
    });
    assert.equal(items.length, 1);
    assert.equal(items[0].command, "echo b-ok");
    assert.equal(items[0].status, "passed");
    assert.equal(items[0].provenance.verified, true);
    // Mixed apps → root allowlist, the old behavior.
    const mixed = collectEvidence({
      worktree: dir,
      files: ["apps/a/a.ts", "apps/b/b.ts"],
    });
    assert.equal(mixed.length, 1);
    assert.equal(mixed[0].command, "echo root-ok");
    console.log("  ✓ collectEvidence runs the app allowlist, root on mixed");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
