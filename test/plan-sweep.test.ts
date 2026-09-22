// test/plan-sweep.test.ts — plan-sweep --apply link rewrite.
//
// Two fixed rounds of dangling links (mem mtjn3ldk, mtl15q4y):
//  1. own-file links were skipped in the sibling layout (plan/ → done/ beside
//     it) under "same depth, existing links still resolve" — same depth is not
//     the same directory, so [other](PLAN-other.md) dangled at done/PLAN-other.md.
//  2. inbound rewrite scanned plan/ only — links from done/ (shipped plans
//     reference each other) and spec/ were left pointing at the old path.

import assert from "node:assert";
import { execSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  cmdPlanSweep,
  rewriteMarkdownLinks,
  rewriteMovedFileLinks,
} from "../src/mem/commands/plan.js";
import { initStore } from "../src/mem/store.js";
import { withTempRepo } from "./helpers.js";

const FAPONY = join(import.meta.dir, "..", "fapony.ts");

function tmp(): string {
  const d = mkdtempSync(join(tmpdir(), "fapony-sweep-"));
  mkdirSync(join(d, "plan"), { recursive: true });
  mkdirSync(join(d, "done"), { recursive: true });
  mkdirSync(join(d, "spec"), { recursive: true });
  return d;
}

export function testRewriteMovedFileLinksSiblingLayout(): void {
  const d = tmp();
  try {
    const oldDir = join(d, "plan");
    const newDir = join(d, "done");
    writeFileSync(join(oldDir, "PLAN-b.md"), "# B\n");
    writeFileSync(join(d, "spec", "SPEC-x.md"), "# X\n");
    const file = join(newDir, "PLAN-a.md");
    writeFileSync(
      file,
      `# A\n\n[b](PLAN-b.md)\n[anch](PLAN-b.md#s1)\n[spec](../spec/SPEC-x.md)\n[broken](NOPE.md)\n[ext](https://x.test)\n[frag](#top)\n`,
    );
    const n = rewriteMovedFileLinks(file, oldDir, newDir);
    assert.equal(n, 2, "only the two sibling links change");
    const out = readFileSync(file, "utf8");
    assert.ok(out.includes("[b](../plan/PLAN-b.md)"), "sibling re-relativized");
    assert.ok(out.includes("[anch](../plan/PLAN-b.md#s1)"), "anchor survives");
    assert.ok(out.includes("[spec](../spec/SPEC-x.md)"), "spec link untouched");
    assert.ok(
      out.includes("[broken](NOPE.md)"),
      "broken link left for plan-check",
    );
    assert.ok(out.includes("[ext](https://x.test)"), "external untouched");
    assert.ok(out.includes("[frag](#top)"), "fragment untouched");
  } finally {
    rmSync(d, { recursive: true, force: true });
  }
  console.log(
    "  ✓ rewriteMovedFileLinks re-relativizes sibling links, ignores the rest",
  );
}

export function testRewriteMovedFileLinksNestedLayout(): void {
  const d = tmp();
  try {
    // legacy layout: done/ one level under plan/
    const oldDir = join(d, "plan");
    const newDir = join(d, "plan", "done");
    mkdirSync(newDir, { recursive: true });
    writeFileSync(join(oldDir, "PLAN-b.md"), "# B\n");
    const file = join(newDir, "PLAN-a.md");
    writeFileSync(file, `# A\n\n[b](PLAN-b.md)\n`);
    const n = rewriteMovedFileLinks(file, oldDir, newDir);
    assert.equal(n, 1);
    assert.ok(
      readFileSync(file, "utf8").includes("[b](../PLAN-b.md)"),
      "one level up from the nested done/",
    );
  } finally {
    rmSync(d, { recursive: true, force: true });
  }
  console.log("  ✓ rewriteMovedFileLinks handles the nested plan/done/ layout");
}

export function testRewriteMarkdownLinksInbound(): void {
  const d = tmp();
  try {
    const oldAbs = join(d, "plan", "PLAN-a.md");
    const newAbs = join(d, "done", "PLAN-a.md");
    const f = join(d, "done", "PLAN-old.md");
    writeFileSync(
      f,
      `# OLD\n\n[a](../plan/PLAN-a.md)\n[a2](../plan/PLAN-a.md#s1)\n[other](PLAN-b.md)\n`,
    );
    const n = rewriteMarkdownLinks(f, oldAbs, newAbs);
    assert.equal(n, 2);
    const out = readFileSync(f, "utf8");
    assert.ok(out.includes("[a](PLAN-a.md)"), "same-dir after the move");
    assert.ok(out.includes("[a2](PLAN-a.md#s1)"), "anchor survives");
    assert.ok(out.includes("[other](PLAN-b.md)"), "unrelated link untouched");
  } finally {
    rmSync(d, { recursive: true, force: true });
  }
  console.log("  ✓ rewriteMarkdownLinks repoints inbound links, keeps anchors");
}

// End to end through the real CLI: sibling layout, inbound from plan/ + done/ +
// spec/, and a tracked doc outside .fapony/ that must be reported, not fixed.
export function testPlanSweepApplyEndToEnd(): void {
  withTempRepo((dir) => {
    mkdirSync(join(dir, ".fapony", "plan"), { recursive: true });
    mkdirSync(join(dir, ".fapony", "done"), { recursive: true });
    mkdirSync(join(dir, ".fapony", "spec"), { recursive: true });
    mkdirSync(join(dir, "docs"), { recursive: true });
    writeFileSync(
      join(dir, ".fapony/plan/PLAN-a.md"),
      `# A\n> ✅ **shipped 2026-09-22** (abc1234)\n\n[b](PLAN-b.md)\n[spec](../spec/SPEC-x.md)\n`,
    );
    writeFileSync(
      join(dir, ".fapony/plan/PLAN-b.md"),
      `# B\n\n[a](PLAN-a.md)\n`,
    );
    writeFileSync(
      join(dir, ".fapony/done/PLAN-old.md"),
      `# OLD\n\n[a](../plan/PLAN-a.md)\n`,
    );
    writeFileSync(
      join(dir, ".fapony/spec/SPEC-x.md"),
      `# X\n\n[a](../plan/PLAN-a.md)\n`,
    );
    writeFileSync(
      join(dir, "docs/NOTE.md"),
      `# note\n\nsee .fapony/plan/PLAN-a.md\n`,
    );
    execSync("git add .", { cwd: dir, stdio: "ignore" });
    execSync('git commit -m "plans"', { cwd: dir, stdio: "ignore" });

    const proc = Bun.spawnSync(
      ["bun", FAPONY, "mem", "plan-sweep", "PLAN-a.md", "--apply"],
      { cwd: dir, stdout: "pipe", stderr: "pipe" },
    );
    const out = proc.stdout.toString() + proc.stderr.toString();
    assert.equal(proc.exitCode, 0, `plan-sweep must succeed:\n${out}`);

    const read = (p: string) => readFileSync(join(dir, p), "utf8");
    assert.ok(
      read(".fapony/done/PLAN-a.md").includes("[b](../plan/PLAN-b.md)"),
      "own sibling link re-relativized",
    );
    assert.ok(
      read(".fapony/done/PLAN-a.md").includes("[spec](../spec/SPEC-x.md)"),
      "own spec link untouched",
    );
    assert.ok(
      read(".fapony/plan/PLAN-b.md").includes("[a](../done/PLAN-a.md)"),
      "inbound from plan/ fixed",
    );
    assert.ok(
      read(".fapony/done/PLAN-old.md").includes("[a](PLAN-a.md)"),
      "inbound from done/ fixed",
    );
    assert.ok(
      read(".fapony/spec/SPEC-x.md").includes("[a](../done/PLAN-a.md)"),
      "inbound from spec/ fixed",
    );
    assert.ok(
      read("docs/NOTE.md").includes(".fapony/plan/PLAN-a.md"),
      "outside files are detect-only, never rewritten",
    );
    assert.match(
      out,
      /files outside .* still mention/,
      "outside mention is reported",
    );
  });
  console.log(
    "  ✓ plan-sweep --apply fixes own + plan/done/spec inbound, reports the rest",
  );
}

// The SKILL example passes the repo-relative path — it must resolve, not "not found".
export function testPlanSweepAcceptsRepoRelativePath(): void {
  withTempRepo((dir) => {
    mkdirSync(join(dir, ".fapony", "plan"), { recursive: true });
    mkdirSync(join(dir, ".fapony", "done"), { recursive: true });
    writeFileSync(
      join(dir, ".fapony/plan/PLAN-a.md"),
      `# A\n> ✅ **shipped 2026-09-22** (abc1234)\n`,
    );
    const proc = Bun.spawnSync(
      ["bun", FAPONY, "mem", "plan-sweep", ".fapony/plan/PLAN-a.md", "--apply"],
      { cwd: dir, stdout: "pipe", stderr: "pipe" },
    );
    const out = proc.stdout.toString() + proc.stderr.toString();
    assert.equal(proc.exitCode, 0, `repo-relative path must resolve:\n${out}`);
    assert.match(out, /moved .*PLAN-a\.md → .*PLAN-a\.md/);
  });
  console.log("  ✓ plan-sweep --apply accepts the repo-relative path form");
}

// The in-process entry (MCP mem path calls initStore + cmdPlanSweep the same
// way) — guards the target-resolution fallback without spawning bun.
export function testCmdPlanSweepInProcess(): void {
  withTempRepo((dir) => {
    mkdirSync(join(dir, ".fapony", "plan"), { recursive: true });
    mkdirSync(join(dir, ".fapony", "done"), { recursive: true });
    writeFileSync(
      join(dir, ".fapony/plan/PLAN-a.md"),
      `# A\n> ✅ **shipped 2026-09-22** (abc1234)\n`,
    );
    const prev = process.cwd();
    process.chdir(dir);
    try {
      initStore(dir);
      cmdPlanSweep(["PLAN-a.md", "--apply"]);
    } finally {
      process.chdir(prev);
    }
    assert.ok(
      readFileSync(join(dir, ".fapony/done/PLAN-a.md"), "utf8").includes(
        "shipped",
      ),
      "file moved to done/",
    );
  });
  console.log("  ✓ cmdPlanSweep moves the file in-process");
}
