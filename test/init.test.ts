import { test } from "bun:test";
import assert from "node:assert";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { initProject, rulesTargets, writeRules } from "../src/init.js";

function withTmpDir(fn: (dir: string) => void): void {
  const dir = mkdtempSync(join(tmpdir(), "fapony-init-"));
  try {
    fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test("testInitCreatesDirectories", () => {
  withTmpDir((tmp) => {
    const target = join(tmp, "project");
    initProject(target);

    assert(existsSync(join(target, ".fapony", "README")), ".fapony/README");
    assert(existsSync(join(target, ".fapony", "plan")), ".fapony/plan/");
    assert(existsSync(join(target, ".fapony", "spec")), ".fapony/spec/");
    assert(existsSync(join(target, ".fapony", "done")), ".fapony/done/");
    assert(
      existsSync(join(target, ".fapony", ".memory")),
      ".fapony/.memory directory",
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
});

test("testInitIdempotent", () => {
  withTmpDir((tmp) => {
    const target = join(tmp, "project");
    initProject(target);

    // Second run should throw
    assert.throws(() => initProject(target), /already exists/);
  });

  console.log("  ✓ init idempotent (re-run errors)");
});

test("testInitNoArgs", () => {
  // cmdInit handles the no-args case; test the function behavior
  // initProject requires a path, so empty string would fail at mkdirSync
  assert.throws(() => initProject(""), /ENOENT|enoent/i);
  console.log("  ✓ init no path errors");
});

// The printed snippet is what the user pastes into their own rules file — it must
// use `fapony mem` (built-in commands) instead of the old `bun <path>/mem.ts`.
test("testInitSnippetPathMatchesScaffold", () => {
  withTmpDir((tmp) => {
    const target = join(tmp, "project");

    const out: string[] = [];
    const realLog = console.log;
    console.log = (...a: unknown[]) => out.push(a.join(" "));
    try {
      initProject(target);
    } finally {
      console.log = realLog;
    }

    const printed = out.join("\n");
    assert(
      printed.includes("fapony mem add decision"),
      "snippet uses fapony mem (built-in), not bun <path>",
    );
    assert(
      !printed.includes("bun .fapony/.memory/mem.ts"),
      "snippet no longer references bun .memory/mem.ts",
    );
  });

  console.log("  ✓ init snippet uses fapony mem (built-in)");
});

// fapony init writes the memory loop into the agent-rules file itself — a
// snippet that only gets printed is a step most users never take.
test("testWriteRulesCreatesAgentsMdWhenNoRulesFile", () => {
  withTmpDir((dir) => {
    assert.deepEqual(rulesTargets(dir), { create: true, append: [] });
    writeRules(dir);
    const agents = readFileSync(join(dir, "AGENTS.md"), "utf-8");
    assert.ok(agents.includes("## Memory: .fapony/.memory"));
    assert.ok(agents.includes("mem_add"), "names the MCP tools");
    // one copy of the rules: Claude Code imports AGENTS.md instead of a duplicate
    assert.equal(readFileSync(join(dir, "CLAUDE.md"), "utf-8"), "@AGENTS.md\n");
    // CLAUDE.md imports the rules, so a rerun must not paste a second copy in
    assert.deepEqual(rulesTargets(dir), { create: false, append: [] });
  });
  console.log("  ✓ no rules file → AGENTS.md + CLAUDE.md importing it");
});

test("testWriteRulesAppendsOnceToExistingFile", () => {
  withTmpDir((dir) => {
    writeFileSync(join(dir, "CLAUDE.md"), "# mine\n");
    assert.deepEqual(rulesTargets(dir), {
      create: false,
      append: [join(dir, "CLAUDE.md")],
    });
    writeRules(dir);
    const once = readFileSync(join(dir, "CLAUDE.md"), "utf-8");
    assert.ok(once.startsWith("# mine\n"), "user's text kept");
    assert.ok(once.includes("## Memory: .fapony/.memory"));
    assert.equal(existsSync(join(dir, "AGENTS.md")), false);
    // already carries the rules → nothing left to do, a rerun changes nothing
    assert.deepEqual(rulesTargets(dir), { create: false, append: [] });
    writeRules(dir);
    assert.equal(readFileSync(join(dir, "CLAUDE.md"), "utf-8"), once);
  });
  console.log("  ✓ existing rules file → appended once, rerun is a no-op");
});

// wt-falsify 2026-09-24: AGENTS.md -> CLAUDE.md symlink got the rules twice,
// once through each name. One real file = one append.
test("testWriteRulesSymlinkedRulesFilesAppendOnce", () => {
  withTmpDir((dir) => {
    writeFileSync(join(dir, "CLAUDE.md"), "# mine\n");
    symlinkSync("CLAUDE.md", join(dir, "AGENTS.md"));
    writeRules(dir);
    const body = readFileSync(join(dir, "CLAUDE.md"), "utf-8");
    assert.equal(body.split("## Memory: .fapony/.memory").length - 1, 1);
  });
  console.log("  ✓ symlinked CLAUDE.md/AGENTS.md → rules appended once");
});

test("testWriteRulesSeparateFilesBothGetRules", () => {
  withTmpDir((dir) => {
    writeFileSync(join(dir, "CLAUDE.md"), "# claude\n");
    writeFileSync(join(dir, "AGENTS.md"), "# agents\n");
    writeRules(dir);
    for (const f of ["CLAUDE.md", "AGENTS.md"])
      assert.equal(
        readFileSync(join(dir, f), "utf-8").split("## Memory: .fapony/.memory")
          .length - 1,
        1,
        f,
      );
  });
  console.log("  ✓ two real rules files → each gets the rules once");
});

test("testWriteRulesReverseSymlinkWritesRealFileOnce", () => {
  withTmpDir((dir) => {
    writeFileSync(join(dir, "AGENTS.md"), "# mine\n");
    symlinkSync("AGENTS.md", join(dir, "CLAUDE.md"));
    writeRules(dir);
    const body = readFileSync(join(dir, "AGENTS.md"), "utf-8");
    assert.equal(body.split("## Memory: .fapony/.memory").length - 1, 1);
  });
  console.log("  ✓ CLAUDE.md -> AGENTS.md symlink → real file written once");
});
