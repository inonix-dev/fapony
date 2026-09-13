import assert from "node:assert";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Config } from "../src/db/index.js";
import { initProject } from "../src/init.js";

function withTmpDir(fn: (dir: string) => void): void {
  const dir = mkdtempSync(join(tmpdir(), "fapony-init-"));
  try {
    fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

export function testInitCreatesDirectories(): void {
  withTmpDir((tmp) => {
    const target = join(tmp, "project");
    initProject(target);

    assert(existsSync(join(target, ".fapony", "README")), ".fapony/README");
    assert(existsSync(join(target, ".fapony", "plan")), ".fapony/plan/");
    assert(existsSync(join(target, ".fapony", "spec")), ".fapony/spec/");
    assert(existsSync(join(target, ".fapony", "done")), ".fapony/done/");
    assert(
      existsSync(join(target, ".fapony", ".memory", "mem.ts")),
      ".fapony/.memory/mem.ts",
    );
    assert(
      existsSync(join(target, ".fapony", "evidence.json")),
      ".fapony/evidence.json",
    );
    // Scaffold must be parseable JSON with the shape evidence.ts expects
    const evidence = JSON.parse(
      readFileSync(join(target, ".fapony", "evidence.json"), "utf-8"),
    );
    assert(Array.isArray(evidence.commands), "evidence.commands is an array");
    assert(
      evidence.commands.every(
        (c: { name?: unknown; cmd?: unknown }) =>
          typeof c.name === "string" &&
          typeof c.cmd === "string" &&
          c.cmd.trim() !== "",
      ),
      "every evidence command has non-empty name + cmd",
    );
  });

  console.log("  ✓ init creates directories");
}

export function testInitIdempotent(): void {
  withTmpDir((tmp) => {
    const target = join(tmp, "project");
    initProject(target);

    // Second run should throw
    assert.throws(() => initProject(target), /already exists/);
  });

  console.log("  ✓ init idempotent (re-run errors)");
}

export function testInitNoArgs(): void {
  // cmdInit handles the no-args case; test the function behavior
  // initProject requires a path, so empty string would fail at mkdirSync
  assert.throws(() => initProject(""), /ENOENT|enoent/i);
  console.log("  ✓ init no path errors");
}

// The printed snippet is what the user pastes into their own rules file — if its
// command path drifts from where mem.ts actually landed, every command in it is
// dead on arrival and nothing errors to say so (that is the bug this whole
// snippet exists to prevent). Pin the two together with a non-default path.
export function testInitSnippetPathMatchesScaffold(): void {
  withTmpDir((tmp) => {
    const target = join(tmp, "project");
    const config = { paths: { memoryEntry: "tools/brain/mem.ts" } } as Config;

    const out: string[] = [];
    const realLog = console.log;
    console.log = (...a: unknown[]) => out.push(a.join(" "));
    try {
      initProject(target, config);
    } finally {
      console.log = realLog;
    }

    const printed = out.join("\n");
    assert(
      printed.includes("bun tools/brain/mem.ts add decision"),
      "snippet uses the configured memoryEntry, not a hardcoded path",
    );
    assert(
      existsSync(join(target, "tools/brain/mem.ts")),
      "the path the snippet tells the user to run actually exists",
    );
  });

  console.log("  ✓ init snippet path matches the scaffolded mem.ts");
}
