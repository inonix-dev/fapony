import { test } from "bun:test";
// test/plan-next.test.ts — `fapony plan [<PLAN.md>]`
import assert from "node:assert";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { cmdPlanNext } from "../src/plan/next.js";
import { initPlanStore } from "../src/plan/store.js";
import { captureLogs, withFakeFael, withTempRepo } from "./helpers.js";

const plan = (title: string, fm: string, ticks: string): string =>
  `---\nkind: unit\n${fm}---\n\n# ${title}\n\n## TL;DR\n${ticks}\n`;

function run(dir: string, args: string[]): string {
  const prev = process.cwd();
  process.chdir(dir);
  try {
    initPlanStore(dir);
    return captureLogs(() => cmdPlanNext(args));
  } finally {
    process.chdir(prev);
  }
}

test("testPlanListsActivePlansPriorityFirst", () => {
  withTempRepo((dir) => {
    const p = join(dir, ".fapony", "plan");
    mkdirSync(p, { recursive: true });
    writeFileSync(
      join(p, "PLAN-a.md"),
      plan("A", "", "- [x] chunk 1 — x\n- [ ] chunk 2 — do a"),
    );
    writeFileSync(
      join(p, "PLAN-b.md"),
      plan("B", "priority: high\n", "- [ ] chunk 1 — do b"),
    );
    writeFileSync(join(p, "PLAN-c.md"), "# C\n> ✅ **shipped 2026-09-01**\n");
    const out = run(dir, []);
    assert.ok(out.indexOf("PLAN-b.md") < out.indexOf("PLAN-a.md"), out);
    assert.match(out, /PLAN-a\.md — 1\/2 chunks\n {2}next: chunk 2 — do a/);
    assert.match(
      out,
      /shipped but not archived into done\/ \(1\)\n- PLAN-c\.md/,
    );
  });
});

test("testPlanShowsFaelHandoffRows", () => {
  withFakeFael((setRows) =>
    withTempRepo((dir) => {
      const p = join(dir, ".fapony", "plan");
      mkdirSync(p, { recursive: true });
      writeFileSync(join(p, "PLAN-x.md"), plan("X", "", "- [ ] chunk 1 — go"));
      setRows([
        {
          id: "n1",
          ts: "2026-09-25T00:00:00Z",
          kind: "note",
          text: "chunk 1 must know Y",
          files: ["src/a.ts", ".fapony/plan/PLAN-x.md"],
        },
        // imported rows carry the plan as spec only
        {
          id: "n2",
          ts: "2026-09-24T00:00:00Z",
          kind: "decision",
          text: "old spec-only row",
          spec: ".fapony/plan/PLAN-x.md",
        },
        {
          id: "n3",
          ts: "2026-09-24T00:00:00Z",
          kind: "note",
          text: "other plan",
          files: [".fapony/plan/PLAN-y.md"],
        },
      ]);
      const out = run(dir, ["PLAN-x"]);
      assert.match(out, /## unchecked\n- \[ \] chunk 1 — go/);
      assert.match(out, /## open in fael \(2\)/);
      assert.match(out, /note \[n1\] chunk 1 must know Y/);
      assert.match(out, /decision \[n2\] old spec-only row/);
      assert.ok(!out.includes("other plan"));
    }),
  );
});
