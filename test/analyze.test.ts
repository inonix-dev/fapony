// test/analyze.test.ts — tests for `fapony analyze` (src/analyze.ts)

import assert from "node:assert";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  blastRadius,
  buildGraph,
  diagnose,
  formatAnalyze,
  isTestFile,
} from "../src/analyze.js";

function withFixture(
  files: Record<string, string>,
  fn: (dir: string) => void,
): void {
  const dir = mkdtempSync(join(tmpdir(), "fapony-analyze-"));
  try {
    for (const [rel, content] of Object.entries(files)) {
      const full = join(dir, rel);
      mkdirSync(join(full, ".."), { recursive: true });
      writeFileSync(full, content);
    }
    fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

export function testAnalyzeHubOrphanCycle(): void {
  withFixture(
    {
      // hub: 3 non-test dependents, no test dependent
      "hub.ts": "export const x = 1;\n",
      "a.ts": 'import { x } from "./hub.js";\nconsole.log(x);\n',
      "b.ts": 'import { x } from "./hub.js";\nconsole.log(x);\n',
      "c.ts": 'import { x } from "./hub.js";\nconsole.log(x);\n',
      // orphan: nobody imports it
      "orphan.ts": "export const y = 2;\n",
      // cycle pair
      "p.ts": 'import "./q.js";\nexport const p = 1;\n',
      "q.ts": 'import "./p.js";\nexport const q = 1;\n',
      // test dependent shields hub2 from hub-untested
      "hub2.ts": "export const z = 3;\n",
      "u1.ts": 'import "./hub2.js";\n',
      "u2.ts": 'import "./hub2.js";\n',
      "u3.ts": 'import "./hub2.js";\n',
      "hub2.test.ts": 'import "./hub2.js";\n',
    },
    (dir) => {
      const graph = buildGraph(dir);
      assert.equal(graph.files.length, 12);

      const findings = diagnose(graph);
      const byKind = (k: string) => findings.filter((f) => f.kind === k);

      const hubs = byKind("hub-untested");
      assert.equal(hubs.length, 1);
      assert.equal(hubs[0].file, "hub.ts");
      assert.ok(hubs[0].detail.includes("3 ไฟล์พึ่งอยู่"));
      assert.ok(hubs[0].evidence.includes("a.ts"));

      const orphans = byKind("orphan");
      assert.ok(orphans.some((f) => f.file === "orphan.ts"));

      const cycles = byKind("cycle");
      assert.equal(cycles.length, 1);
      assert.ok(
        cycles[0].file.includes("p.ts") && cycles[0].file.includes("q.ts"),
      );

      // hub2 has a test dependent → not flagged
      assert.ok(!hubs.some((f) => f.file === "hub2.ts"));
      // entry points and tests are never orphans
      assert.ok(!orphans.some((f) => f.file.endsWith(".test.ts")));
    },
  );
  console.log("  ✓ analyze finds hub-untested, orphan, and cycle fixtures");
}

export function testAnalyzeChangedUntested(): void {
  withFixture(
    {
      "core.ts": "export const x = 1;\n",
      "user.ts": 'import "./core.js";\n',
    },
    (dir) => {
      const graph = buildGraph(dir);
      const findings = diagnose(graph, ["core.ts", "missing.ts", "README.md"]);
      const changed = findings.filter((f) => f.kind === "changed-untested");
      assert.equal(changed.length, 1);
      assert.equal(changed[0].file, "core.ts");
      // unknown / non-source files are skipped silently
      assert.ok(!findings.some((f) => f.file === "missing.ts"));
    },
  );
  console.log("  ✓ analyze flags changed-untested only for known source files");
}

export function testAnalyzeSkipsUnresolvableAndBroken(): void {
  withFixture(
    {
      "ok.ts":
        'import "bun:sqlite";\nimport "@/alias/x";\nimport "./nope.js";\n',
      "broken.ts": "import { from (((",
    },
    (dir) => {
      const graph = buildGraph(dir);
      // 3 unresolvable in ok.ts + 1 skipped broken file — no throw
      assert.equal(graph.unresolved, 4);
      assert.equal(graph.files.length, 2);
    },
  );
  console.log("  ✓ analyze counts unresolved instead of throwing");
}

export function testAnalyzeEmptyDir(): void {
  withFixture({}, (dir) => {
    const graph = buildGraph(dir);
    assert.equal(graph.files.length, 0);
    const text = formatAnalyze(graph, diagnose(graph));
    assert.ok(text.includes("0 files scanned"));
    assert.ok(text.includes("no findings"));
  });
  console.log("  ✓ analyze on empty dir reports no findings");
}

export function testAnalyzeBlastRadius(): void {
  withFixture(
    {
      "core.ts": "export const x = 1;\n",
      "user.ts": 'import "./core.js";\n',
      "core.test.ts": 'import "./core.js";\n',
    },
    (dir) => {
      const graph = buildGraph(dir);
      const blast = blastRadius(graph, ["core.ts", "user.ts"]);
      assert.equal(blast["core.ts"].dependents, 2);
      assert.equal(blast["core.ts"].tested, true);
      assert.equal(blast["user.ts"].dependents, 0);
      assert.equal(blast["user.ts"].tested, false);
    },
  );
  console.log("  ✓ analyze blastRadius counts dependents and test coverage");
}

export function testAnalyzeBlastRadiusTransitive(): void {
  withFixture(
    {
      // core <- mid <- leaf : leaf is a transitive (not direct) dependent of core.
      "core.ts": "export const x = 1;\n",
      "mid.ts": 'import "./core.js";\n',
      "leaf.ts": 'import "./mid.js";\n',
    },
    (dir) => {
      const graph = buildGraph(dir);
      const blast = blastRadius(graph, ["core.ts", "leaf.ts"]);
      assert.equal(blast["core.ts"].dependents, 1);
      assert.equal(blast["core.ts"].transitive, 2, "mid + leaf, both hops");
      assert.equal(blast["leaf.ts"].transitive, 0, "nothing imports leaf");
    },
  );
  console.log(
    "  ✓ analyze blastRadius walks transitive dependents, cycle-safe",
  );
}

export function testAnalyzeBlastRadiusTransitiveCycle(): void {
  withFixture(
    {
      "a.ts": 'import "./b.js";\n',
      "b.ts": 'import "./a.js";\n',
    },
    (dir) => {
      const graph = buildGraph(dir);
      const blast = blastRadius(graph, ["a.ts"]);
      // a <- b <- a: BFS must terminate and not double-count the cycle.
      assert.equal(blast["a.ts"].transitive, 1);
    },
  );
  console.log("  ✓ analyze blastRadius transitive walk terminates on cycles");
}

export function testAnalyzeIsTestFile(): void {
  assert.equal(isTestFile("src/foo.test.ts"), true);
  assert.equal(isTestFile("test/bar.ts"), true);
  assert.equal(isTestFile("src/foo.ts"), false);
  console.log("  ✓ analyze isTestFile matches collect criteria");
}

export function testAnalyzeSkipsNestedCheckouts(): void {
  withFixture(
    {
      "core.ts": "export const a = 1;\n",
      "core.test.ts": 'import { a } from "./core.js";\nexport const t = a;\n',
      // A clone has `.git` as a directory, a `git worktree` has it as a file.
      // Neither is part of this project; both used to be walked unless their
      // name happened to start with `wt-`.
      "clone/.git/HEAD": "ref: refs/heads/main\n",
      "clone/core.ts": "export const a = 1;\n",
      "sub/.git": "gitdir: /elsewhere/.git/worktrees/sub\n",
      "sub/core.ts": "export const a = 1;\n",
      // A plain directory named like someone's worktree convention is still
      // this project and must be walked.
      "wt-real/core.ts": "export const a = 1;\n",
    },
    (dir) => {
      const graph = buildGraph(dir);
      assert.deepEqual(
        graph.files.filter((f) => f.includes("/")).sort(),
        ["wt-real/core.ts"],
        "nested checkouts walked, or a plain dir skipped by name",
      );
    },
  );
}

export function testAnalyzeBarrelHidesTests(): void {
  withFixture(
    {
      // Four modules behind a barrel, one test importing only the barrel —
      // the real-world shape of src/db/index.ts and src/stats.ts.
      "core.ts": "export const a = 1;\n",
      "index.ts": 'export * from "./core.js";\n',
      "u1.ts": 'import { a } from "./core.js";\nexport const x = a;\n',
      "u2.ts": 'import { a } from "./core.js";\nexport const y = a;\n',
      "u3.ts": 'import { a } from "./core.js";\nexport const z = a;\n',
      "core.test.ts": 'import { a } from "./index.js";\nexport const t = a;\n',
    },
    (dir) => {
      const graph = buildGraph(dir);
      assert.ok(graph.barrels.has("index.ts"), "barrel not detected");
      assert.ok(!graph.barrels.has("u1.ts"), "plain module flagged as barrel");
      const hubs = diagnose(graph).filter((f) => f.kind === "hub-untested");
      assert.deepEqual(
        hubs.map((f) => f.file),
        [],
        "test reaching core.ts through the barrel must count as coverage",
      );
      assert.equal(blastRadius(graph, ["core.ts"])["core.ts"].tested, true);
    },
  );
  withFixture(
    {
      // Same shape, no test anywhere: the finding must still fire.
      "core.ts": "export const a = 1;\n",
      "index.ts": 'export * from "./core.js";\n',
      "u1.ts": 'import { a } from "./core.js";\nexport const x = a;\n',
      "u2.ts": 'import { a } from "./core.js";\nexport const y = a;\n',
      "u3.ts": 'import { a } from "./core.js";\nexport const z = a;\n',
    },
    (dir) => {
      const hubs = diagnose(buildGraph(dir)).filter(
        (f) => f.kind === "hub-untested",
      );
      assert.ok(
        hubs.some((f) => f.file === "core.ts"),
        "untested hub must still be reported",
      );
    },
  );
  console.log("  ✓ analyze sees tests that import through a barrel file");
}
