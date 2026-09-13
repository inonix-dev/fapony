// test/mcp/plans.test.ts — tests for plan_list tool

import assert from "node:assert";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { addEvent, newRun, openDb } from "../../src/db/index.js";
import { toolPlanList } from "../../src/mcp/tools/plans.js";
import { parseToolResult } from "../../src/mcp/types.js";

function withTempDb(fn: () => void): void {
  const oldEnv = process.env.FAPONY_STATE_DIR;
  const tmpDir = mkdtempSync(join(tmpdir(), "fapony-mcp-plans-"));
  process.env.FAPONY_STATE_DIR = tmpDir;
  try {
    fn();
  } finally {
    if (oldEnv !== undefined) {
      process.env.FAPONY_STATE_DIR = oldEnv;
    } else {
      delete process.env.FAPONY_STATE_DIR;
    }
  }
}

function makeWorktree(): string {
  const wt = mkdtempSync(join(tmpdir(), "fapony-plans-wt-"));
  mkdirSync(join(wt, ".fapony", "plan"), { recursive: true });
  mkdirSync(join(wt, ".fapony", "done"), { recursive: true });
  return wt;
}

export function testPlanListRequiresWorktree(): void {
  const result = toolPlanList({});
  assert.ok(result.isError);
  console.log("  ✓ plan_list requires worktree");
}

export function testPlanListMissingDir(): void {
  const wt = mkdtempSync(join(tmpdir(), "fapony-plans-empty-"));
  const result = toolPlanList({ worktree: wt });
  const data = parseToolResult(result) as {
    untouched: unknown[];
    done: number;
  };
  assert.deepEqual(data.untouched, []);
  assert.equal(data.done, 0);
  console.log("  ✓ plan_list handles missing plan dir");
}

export function testPlanListNeverAttempted(): void {
  withTempDb(() => {
    const wt = makeWorktree();
    writeFileSync(
      join(wt, ".fapony", "plan", "PLAN-foo.md"),
      "# Foo plan\n\nbody",
    );
    const result = toolPlanList({ worktree: wt });
    const data = parseToolResult(result) as {
      untouched: { file: string; title: string; runs: number; last: string }[];
      done: number;
    };
    assert.equal(data.untouched.length, 1);
    assert.equal(data.untouched[0].file, "PLAN-foo.md");
    assert.equal(data.untouched[0].title, "Foo plan");
    assert.equal(data.untouched[0].runs, 0);
    assert.equal(data.untouched[0].last, "never attempted");
    assert.equal(data.done, 0);
  });
  console.log("  ✓ plan_list reports never-attempted plans");
}

export function testPlanListJoinsRunHistory(): void {
  withTempDb(() => {
    const wt = makeWorktree();
    const planPath = join(wt, ".fapony", "plan", "PLAN-bar.md");
    writeFileSync(planPath, "# Bar plan\n\nbody");
    writeFileSync(join(wt, ".fapony", "done", "PLAN-old.md"), "# Old");

    const db = openDb();
    const runId = newRun(db, "myproj", planPath, null, "abc123");
    addEvent(db, runId, "gate", { verdict: "fail", reason_code: "spec_gap" });

    const result = toolPlanList({ worktree: wt });
    const data = parseToolResult(result) as {
      active: { file: string; runs: number; last: string }[];
      done: number;
    };
    const bar = data.active.find((p) => p.file === "PLAN-bar.md");
    assert.ok(bar);
    assert.equal(bar?.runs, 1);
    assert.equal(bar?.last, "fail(spec_gap)");
    assert.equal(data.done, 1);
  });
  console.log("  ✓ plan_list joins pending plan against run history");
}

export function testPlanListUsesWorktreeConfigPaths(): void {
  withTempDb(() => {
    const wt = mkdtempSync(join(tmpdir(), "fapony-plans-cfg-"));
    mkdirSync(join(wt, "apps", "vela", "plan"), { recursive: true });
    writeFileSync(
      join(wt, "fapony.config.json"),
      JSON.stringify({ paths: { planDir: "apps/vela/plan" } }),
    );
    writeFileSync(join(wt, "apps", "vela", "plan", "PLAN-x.md"), "# X plan");

    const result = toolPlanList({ worktree: wt });
    const data = parseToolResult(result) as {
      untouched: { file: string }[];
      error?: string;
    };
    assert.equal(data.error, undefined);
    assert.equal(data.untouched[0]?.file, "PLAN-x.md");
  });
  console.log("  ✓ plan_list honors worktree-local paths.planDir");
}

export function testPlanListGroupsByFrontmatter(): void {
  withTempDb(() => {
    const wt = makeWorktree();
    const dir = join(wt, ".fapony", "plan");
    const w = (f: string, body: string) => writeFileSync(join(dir, f), body);
    w("PLAN-v1.md", "---\nkind: tracker\n---\n# V1 tracker");
    w(
      "PLAN-attendance.md",
      "---\nstatus: blocked\nblocked_by: PLAN-mdl.md\n---\n# Attendance",
    );
    w(
      "PLAN-calendar.md",
      "---\nstatus: active\nblocks: PLAN-export.md\n---\n# Calendar",
    );
    w("PLAN-export.md", "---\nstatus: active\n---\n# Export");
    w(
      "PLAN-old.md",
      "---\nstatus: superseded\nsuperseded_by: PLAN-v1.md\n---\n# Old",
    );
    w("PLAN-bare.md", "# Bare");

    const data = parseToolResult(toolPlanList({ worktree: wt })) as Record<
      string,
      { file: string; blocks?: string[] }[]
    >;
    assert.deepEqual(
      data.trackers.map((p) => p.file),
      ["PLAN-v1.md"],
    );
    assert.deepEqual(
      data.blocked.map((p) => p.file),
      ["PLAN-attendance.md"],
    );
    assert.deepEqual(
      data.superseded.map((p) => p.file),
      ["PLAN-old.md"],
    );
    assert.deepEqual(
      data.untouched.map((p) => p.file),
      ["PLAN-bare.md"],
    );
    // What unblocks something else sorts ahead of what doesn't.
    assert.deepEqual(
      data.active.map((p) => p.file),
      ["PLAN-calendar.md", "PLAN-export.md"],
    );
  });
  console.log("  ✓ plan_list groups by frontmatter and orders by blocks");
}

export function testPlanListProgressAndMarkdown(): void {
  withTempDb(() => {
    const wt = makeWorktree();
    const dir = join(wt, ".fapony", "plan");
    writeFileSync(
      join(dir, "PLAN-calendar.md"),
      [
        "---",
        "status: active",
        "blocks: PLAN-export.md",
        "spec: SPEC-calendar.md",
        "---",
        "",
        "# PLAN — calendar",
        "",
        "## TL;DR",
        "- **what:** month view",
        "- [x] chunk 1",
        "- [ ] chunk 2",
        "",
        "## 6. Steps",
        "- [ ] a step deep in the body must not count as status",
        "- [ ] neither must this one",
      ].join("\n"),
    );
    const data = parseToolResult(toolPlanList({ worktree: wt })) as {
      active: { progress?: string; spec?: string }[];
    };
    assert.equal(data.active[0].progress, "1/2");
    assert.equal(data.active[0].spec, "SPEC-calendar.md");

    const md = toolPlanList({ worktree: wt, format: "markdown" }).content[0]
      .text;
    assert.ok(md.includes("## active — in order (1)"));
    assert.ok(md.includes("PLAN-calendar — 1/2 · unblocks PLAN-export.md"));
    assert.ok(md.includes("done: 0 archived"));
  });
  console.log("  ✓ plan_list counts summary checkboxes and renders markdown");
}

export function testPlanListLegacyArchiveLocation(): void {
  withTempDb(() => {
    // Repos scaffolded before done/ moved beside plan/ keep plan/done/ — their
    // archive count must not silently drop to zero.
    const wt = mkdtempSync(join(tmpdir(), "fapony-plans-legacy-"));
    mkdirSync(join(wt, ".fapony", "plan", "done"), { recursive: true });
    writeFileSync(join(wt, ".fapony", "plan", "done", "PLAN-old.md"), "# Old");
    const data = parseToolResult(toolPlanList({ worktree: wt })) as {
      done: number;
    };
    assert.equal(data.done, 1);
  });
  console.log("  ✓ plan_list falls back to the legacy plan/done/ archive");
}
