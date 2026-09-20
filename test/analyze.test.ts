// test/analyze.test.ts — tests for `fapony analyze` (src/analyze.ts)

import assert from "node:assert";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  blastRadius,
  buildGraph,
  buildGraphCached,
  collectSourceFiles,
  diagnose,
  exportsThroughBarrels,
  formatAnalyze,
  graphCachePath,
  isTestFile,
  resetGraphCache,
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
      assert.ok(hubs[0].detail.includes("3 files depend on it"));
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
      // alias + relative miss in ok.ts + 1 skipped broken file — no throw
      assert.equal(graph.unresolved, 3);
      // bun:sqlite is a builtin: counted apart, never a hidden project edge
      assert.equal(graph.external, 1);
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

// Bun.Transpiler.scan() reports `export * from` as an import, never an export,
// so a barrel reads as zero exports and a symbol behind one looks unused.
export function testAnalyzeExportsThroughBarrels(): void {
  withFixture(
    {
      "src/fail-with.ts": "export function failWith(): never { throw 1; }\n",
      "src/helper.ts": "export const helper = 1;\n",
      "src/inner/index.ts": 'export * from "../helper";\n',
      "src/index.ts":
        'export * from "./fail-with";\nexport * from "./inner";\nexport const own = 2;\n',
      // a barrel that re-exports its own parent must not loop forever
      "src/cycle-a.ts": 'export * from "./cycle-b";\n',
      "src/cycle-b.ts": 'export * from "./cycle-a";\nexport const b = 1;\n',
    },
    (dir) => {
      const files = new Set(collectSourceFiles(dir));
      const got = exportsThroughBarrels(dir, "src/index.ts", files).sort();
      assert.deepStrictEqual(got, ["failWith", "helper", "own"]);
      assert.deepStrictEqual(
        exportsThroughBarrels(dir, "src/cycle-a.ts", files),
        ["b"],
      );
    },
  );
}

// The disk mirror exists so the Edit hint does not rebuild the graph on every
// hook call (a Claude Code hook is a fresh process each time). It must write
// through on build, be read on a later process, invalidate when a source file
// changes (the fingerprint), and never throw on a corrupt cache.
export function testGraphCacheWriteThroughInvalidateFallback(): void {
  const state = mkdtempSync(join(tmpdir(), "fapony-graphcache-"));
  const orig = process.env.FAPONY_STATE_DIR;
  process.env.FAPONY_STATE_DIR = state;
  try {
    withFixture(
      {
        "hub.ts": "export const x = 1;\n",
        "a.ts": 'import { x } from "./hub.js";\nconsole.log(x);\n',
        "lone.ts": "export const y = 2;\n",
      },
      (dir) => {
        resetGraphCache();
        const g1 = buildGraphCached(dir);
        assert.equal(g1.dependents.get("hub.ts")?.size, 1, "a.ts imports hub");
        const cachePath = graphCachePath(dir);
        assert.ok(existsSync(cachePath), "build writes the graph cache");

        // A fresh process must read the cache, not rebuild: doctor the stored
        // graph while leaving the source-file fingerprint valid, and a rebuild
        // would have produced a different answer.
        const raw = JSON.parse(readFileSync(cachePath, "utf-8")) as {
          dependents: Record<string, string[]>;
        };
        raw.dependents["hub.ts"] = [];
        writeFileSync(cachePath, JSON.stringify(raw));
        resetGraphCache();
        assert.equal(
          buildGraphCached(dir).dependents.get("hub.ts")?.size,
          0,
          "later call returned the cached graph, not a rebuild",
        );

        // Editing a source file moves size/mtime → fingerprint mismatch → rebuild.
        writeFileSync(
          join(dir, "lone.ts"),
          'import { x } from "./hub.js";\nconsole.log(x);\n',
        );
        resetGraphCache();
        assert.equal(
          buildGraphCached(dir).dependents.get("hub.ts")?.size,
          2,
          "an edited source file invalidates the cache",
        );

        // A torn/corrupt cache is ignored, not fatal.
        writeFileSync(cachePath, "{ not json");
        resetGraphCache();
        assert.equal(
          buildGraphCached(dir).dependents.get("hub.ts")?.size,
          2,
          "a corrupt cache falls back to a live build",
        );
      },
    );
  } finally {
    if (orig === undefined) delete process.env.FAPONY_STATE_DIR;
    else process.env.FAPONY_STATE_DIR = orig;
    rmSync(state, { recursive: true, force: true });
  }
  console.log(
    "  ✓ graph cache: write-through, read, invalidate, corrupt fallback",
  );
}

// Same-process calls must not serve a stale graph: the in-process hit is
// revalidated against the fingerprint, so an edit between two calls rebuilds
// even without resetGraphCache() (which only simulates a fresh process).
export function testGraphCacheInProcessInvalidation(): void {
  const state = mkdtempSync(join(tmpdir(), "fapony-graphcache-inproc-"));
  const orig = process.env.FAPONY_STATE_DIR;
  process.env.FAPONY_STATE_DIR = state;
  try {
    withFixture(
      {
        "hub.ts": "export const x = 1;\n",
        "a.ts": 'import { x } from "./hub.js";\nconsole.log(x);\n',
      },
      (dir) => {
        resetGraphCache();
        assert.equal(
          buildGraphCached(dir).dependents.get("hub.ts")?.size,
          1,
          "a.ts imports hub",
        );
        writeFileSync(
          join(dir, "b.ts"),
          'import { x } from "./hub.js";\nconsole.log(x);\n',
        );
        assert.equal(
          buildGraphCached(dir).dependents.get("hub.ts")?.size,
          2,
          "a same-process call after adding an importer rebuilds",
        );
        resetGraphCache();
      },
    );
  } finally {
    if (orig === undefined) delete process.env.FAPONY_STATE_DIR;
    else process.env.FAPONY_STATE_DIR = orig;
    rmSync(state, { recursive: true, force: true });
  }
  console.log("  ✓ graph cache: same-process call invalidates on edit");
}
