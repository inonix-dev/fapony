import { test } from "bun:test";
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
} from "../src/analyze/index.js";

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

test("testAnalyzeHubOrphanCycle", () => {
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
});

test("testAnalyzeChangedUntested", () => {
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
});

test("testAnalyzeSkipsUnresolvableAndBroken", () => {
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
});

test("testAnalyzeEmptyDir", () => {
  withFixture({}, (dir) => {
    const graph = buildGraph(dir);
    assert.equal(graph.files.length, 0);
    const text = formatAnalyze(graph, diagnose(graph));
    assert.ok(text.includes("0 files scanned"));
    assert.ok(text.includes("nothing analyzed"));
    assert.ok(!text.includes("healthy"));
  });
  console.log("  ✓ analyze on empty dir says nothing was analyzed");
});

test("testAnalyzeBlastRadius", () => {
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
});

test("testAnalyzeBlastRadiusTransitive", () => {
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
});

test("testAnalyzeBlastRadiusTransitiveCycle", () => {
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
});

test("testAnalyzeIsTestFile", () => {
  assert.equal(isTestFile("src/foo.test.ts"), true);
  assert.equal(isTestFile("test/bar.ts"), true);
  assert.equal(isTestFile("src/foo.ts"), false);
  console.log("  ✓ analyze isTestFile matches collect criteria");
});

test("testAnalyzeSkipsNestedCheckouts", () => {
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
});

test("testAnalyzeBarrelHidesTests", () => {
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
});

// Bun.Transpiler.scan() reports `export * from` as an import, never an export,
// so a barrel reads as zero exports and a symbol behind one looks unused.
test("testAnalyzeExportsThroughBarrels", () => {
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
});

// The disk mirror exists so the Edit hint does not rebuild the graph on every
// hook call (a Claude Code hook is a fresh process each time). It must write
// through on build, be read on a later process, invalidate when a source file
// changes (the fingerprint), and never throw on a corrupt cache.
test("testGraphCacheWriteThroughInvalidateFallback", () => {
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
});

// Same-process calls must not serve a stale graph: the in-process hit is
// revalidated against the fingerprint, so an edit between two calls rebuilds
// even without resetGraphCache() (which only simulates a fresh process).
test("testGraphCacheInProcessInvalidation", () => {
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
});

test("testAnalyzePythonRelativeGraph", () => {
  withFixture(
    {
      "pkg/__init__.py": "",
      "pkg/core.py": "VALUE = 1\ndef helper(): ...\n",
      "pkg/user.py": "from .core import helper\nprint(helper)\n",
      "pkg/sub/__init__.py": "",
      "pkg/sub/sib.py": "SIB = 1\n",
      "pkg/sub/deep.py":
        "from ..core import helper\nfrom . import sib\nprint(helper, sib)\n",
      // Absolute imports resolve when the target is in this repo (`pkg.core`
      // → pkg/core.py); `import os` is stdlib → external, not unresolved.
      "top.py": "import os\nfrom pkg.core import helper\nprint(os, helper)\n",
    },
    (dir) => {
      const graph = buildGraph(dir);
      assert.ok(graph.files.includes("pkg/user.py"), "py files are scanned");
      assert.deepEqual(
        [...(graph.deps.get("pkg/user.py") ?? [])],
        ["pkg/core.py"],
      );
      assert.deepEqual([...(graph.deps.get("pkg/sub/deep.py") ?? [])].sort(), [
        "pkg/core.py",
        "pkg/sub/__init__.py",
        "pkg/sub/sib.py",
      ]);
      assert.deepEqual([...(graph.deps.get("top.py") ?? [])], ["pkg/core.py"]);
      assert.equal(graph.unresolved, 0, "import os is stdlib, not unresolved");
      assert.equal(graph.external, 1, "import os only");
      assert.equal(graph.dependents.get("pkg/core.py")?.size, 3);
      assert.equal(graph.dependents.get("pkg/sub/sib.py")?.size, 1);
    },
  );
  console.log(
    "  ✓ analyze resolves python relative imports (.py + __init__.py)",
  );
});

test("testAnalyzePythonBarrel", () => {
  withFixture(
    {
      "pkg/__init__.py":
        '"""Pkg."""\nfrom .core import *\nfrom .extra import thing\n__all__ = ["helper", "thing"]\n',
      "pkg/core.py": "def helper(): ...\n",
      "pkg/extra.py": "thing = 1\n",
      "plain/__init__.py": "VALUE = 1\ndef f(): ...\n",
      "test_pkg.py": "from .pkg import helper\nassert helper\n",
    },
    (dir) => {
      const graph = buildGraph(dir);
      assert.ok(graph.barrels.has("pkg/__init__.py"), "re-export-only init");
      assert.ok(
        !graph.barrels.has("plain/__init__.py"),
        "init with defs is not a barrel",
      );
      assert.deepEqual(
        exportsThroughBarrels(
          dir,
          "pkg/__init__.py",
          new Set(collectSourceFiles(dir)),
        ).sort(),
        ["helper", "thing"],
      );
      // The test reaches core.py only through the barrel — still coverage.
      assert.equal(
        blastRadius(graph, ["pkg/core.py"])["pkg/core.py"].tested,
        true,
      );
    },
  );
  console.log("  ✓ analyze treats a re-export __init__.py as a barrel");
});

test("testAnalyzeIsTestFilePy", () => {
  assert.equal(isTestFile("test_foo.py"), true);
  assert.equal(isTestFile("pkg/foo_test.py"), true);
  assert.equal(isTestFile("tests/test_bar.py"), true);
  assert.equal(isTestFile("testing.py"), false);
  assert.equal(isTestFile("contest.py"), false);
  assert.equal(isTestFile("latest.py"), false);
  assert.equal(isTestFile("src/foo.py"), false);
  console.log("  ✓ analyze isTestFile covers test_*.py and *_test.py");
});

test("testAnalyzeSkipsVenv", () => {
  withFixture(
    {
      "real.py": "X = 1\n",
      ".venv/lib/site-packages/dep.py": "Y = 2\n",
    },
    (dir) => {
      const graph = buildGraph(dir);
      assert.deepEqual(graph.files, ["real.py"]);
    },
  );
  console.log("  ✓ analyze never walks .venv");
});

test("testAnalyzePythonFromImportSubmodule", () => {
  withFixture(
    {
      "pkg/__init__.py": "from . import sub\n",
      "pkg/sub.py": "SUB = 1\n",
      "pkg/user.py": "from . import sub as s, missing\n",
    },
    (dir) => {
      const graph = buildGraph(dir);
      // `from . import sub` reaches sub.py, not the package __init__.py alone.
      assert.ok(
        graph.deps.get("pkg/user.py")?.has("pkg/sub.py"),
        "named submodule is an edge",
      );
      assert.equal(graph.dependents.get("pkg/sub.py")?.size, 2);
      // `from . import sub` inside __init__.py must not point at itself.
      assert.ok(!graph.deps.get("pkg/__init__.py")?.has("pkg/__init__.py"));
      // The module resolves, so `missing` is treated as a package attribute
      // (not a submodule miss) — no unresolved edge.
      assert.equal(graph.unresolved, 0);
    },
  );
  console.log("  ✓ analyze resolves `from . import submodule` to the file");
});

test("testAnalyzePythonAbsoluteSrcLayout", () => {
  withFixture(
    {
      "src/mypkg/__init__.py": "from .core import helper\n",
      "src/mypkg/core.py": "def helper():\n    return 1\n",
      "tests/test_core.py": "from mypkg.core import helper\n",
    },
    (dir) => {
      const graph = buildGraph(dir);
      assert.ok(
        graph.deps.get("tests/test_core.py")?.has("src/mypkg/core.py"),
        "src-layout absolute import resolves",
      );
      assert.equal(
        blastRadius(graph, ["src/mypkg/core.py"])["src/mypkg/core.py"].tested,
        true,
      );
    },
  );
  console.log("  ✓ analyze resolves same-repo absolute imports (src layout)");
});

test("testAnalyzePythonAbsoluteBareNameNotMatched", () => {
  withFixture(
    {
      "src/mypkg/__init__.py": "",
      "src/mypkg/core.py": "def helper():\n    return 1\n",
      // A bare `import core` must NOT bind to src/mypkg/core.py — only the
      // dotted `mypkg.core` is a real module path.
      "src/mypkg/consumer.py": "import core\nprint(core)\n",
    },
    (dir) => {
      const graph = buildGraph(dir);
      assert.deepEqual(
        [...(graph.deps.get("src/mypkg/consumer.py") ?? [])],
        [],
      );
      assert.equal(graph.unresolved, 1);
    },
  );
  console.log("  ✓ analyze does not resolve a bare name to a nested module");
});

test("testAnalyzePythonIgnoresImportsInStrings", () => {
  withFixture(
    {
      "pkg/__init__.py": "",
      "pkg/core.py": "VALUE = 1\n",
      "pkg/user.py":
        '"""\nfrom .core import VALUE\n"""\nTEMPLATE = """\nfrom .core import VALUE\n"""\nprint(1)\n',
    },
    (dir) => {
      const graph = buildGraph(dir);
      assert.deepEqual([...(graph.deps.get("pkg/user.py") ?? [])], []);
      assert.equal(graph.unresolved, 0);
    },
  );
  console.log("  ✓ analyze ignores imports written inside strings/docstrings");
});

test("testAnalyzePythonStdlibExternal", () => {
  withFixture(
    {
      "a.py": "import os, sys\nfrom json import dumps\nprint(os, sys, dumps)\n",
    },
    (dir) => {
      const graph = buildGraph(dir);
      assert.equal(graph.external, 3, "os + sys + json");
      assert.equal(graph.unresolved, 0);
    },
  );
  withFixture(
    {
      "b.py": "from os.path import join\nprint(join)\n",
    },
    (dir) => {
      const graph = buildGraph(dir);
      assert.equal(graph.external, 1, "root os of os.path");
      assert.equal(graph.unresolved, 0);
    },
  );
  withFixture(
    {
      "c.py": "import requests\nprint(requests)\n",
    },
    (dir) => {
      const graph = buildGraph(dir);
      assert.equal(graph.external, 0, "third-party is not stdlib");
      assert.equal(graph.unresolved, 1);
    },
  );
  console.log(
    "  ✓ analyze counts stdlib as external, third-party as unresolved",
  );
});

test("testAnalyzePythonPyiShadowAndStubOnly", () => {
  withFixture(
    {
      "pkg/__init__.py": "",
      "pkg/x.py": "def f():\n    return 1\n",
      "pkg/x.pyi": "def f() -> int: ...\n",
      "pkg/user.py": "from .x import f\nprint(f)\n",
    },
    (dir) => {
      const graph = buildGraph(dir);
      assert.ok(graph.files.includes("pkg/x.py"), "x.py is the node");
      assert.ok(!graph.files.includes("pkg/x.pyi"), "shadowed stub is dropped");
      assert.deepEqual(
        [...(graph.deps.get("pkg/user.py") ?? [])],
        ["pkg/x.py"],
      );
      assert.equal(
        graph.dependents.get("pkg/x.py")?.size,
        1,
        "no double-count",
      );
    },
  );
  withFixture(
    {
      "pkg/__init__.py": "",
      "pkg/y.pyi": "def g() -> int: ...\n",
      "pkg/user.py": "from .y import g\nprint(g)\n",
    },
    (dir) => {
      const graph = buildGraph(dir);
      assert.ok(graph.files.includes("pkg/y.pyi"), "stub-only is scanned");
      assert.deepEqual(
        [...(graph.deps.get("pkg/user.py") ?? [])],
        ["pkg/y.pyi"],
      );
    },
  );
  console.log("  ✓ analyze shadows x.pyi behind x.py, resolves stub-only");
});

test("testAnalyzePythonMainEntryPoint", () => {
  withFixture(
    {
      "pkg/__init__.py": "",
      "pkg/__main__.py": "from .core import helper\nprint(helper)\n",
      "pkg/core.py": "def helper():\n    return 1\n",
      "pkg/cli.py": "CLI = 1\n",
      "pkg/main.py": "MAIN = 1\n",
    },
    (dir) => {
      const graph = buildGraph(dir);
      const orphans = diagnose(graph)
        .filter((f) => f.kind === "orphan")
        .map((f) => f.file);
      assert.ok(
        !orphans.includes("pkg/__main__.py"),
        "__main__.py is an entry point",
      );
      assert.ok(orphans.includes("pkg/cli.py"), "cli.py still orphan");
      assert.ok(orphans.includes("pkg/main.py"), "main.py still orphan");
    },
  );
  console.log("  ✓ analyze treats __main__.py as entry, not cli.py/main.py");
});

test("testAnalyzePythonParenthesizedSubmoduleImport", () => {
  withFixture(
    {
      "pkg/__init__.py": "",
      "pkg/sub.py": "SUB = 1\n",
      // A parenthesized name list spans lines — `sub` must still be read,
      // or the submodule reads as an orphan.
      "pkg/user.py": "from . import (\n    sub,\n)\nprint(sub)\n",
    },
    (dir) => {
      const graph = buildGraph(dir);
      assert.ok(
        graph.deps.get("pkg/user.py")?.has("pkg/sub.py"),
        "multi-line parenthesized submodule is an edge",
      );
      assert.equal(graph.dependents.get("pkg/sub.py")?.size, 1);
      assert.equal(graph.unresolved, 0);
    },
  );
  console.log("  ✓ analyze resolves a multi-line `from . import (sub)`");
});

test("testAnalyzePythonTripleQuoteInsideString", () => {
  withFixture(
    {
      "pkg/__init__.py": "",
      "pkg/core.py": "VALUE = 1\n",
      // A triple quote inside a single-quoted string must not open a block and
      // mask the rest of the file (imports silently lost → false orphans).
      "pkg/user.py":
        'x = \'contains """ here\'\nfrom .core import VALUE\nprint(x, VALUE)\n',
    },
    (dir) => {
      const graph = buildGraph(dir);
      assert.ok(
        graph.deps.get("pkg/user.py")?.has("pkg/core.py"),
        "import after the string survives",
      );
      assert.equal(graph.dependents.get("pkg/core.py")?.size, 1);
      assert.equal(graph.unresolved, 0);
    },
  );
  console.log(
    "  ✓ analyze keeps imports after a string holding a triple quote",
  );
});

test("testAnalyzePythonEntryPointsAndDeps", () => {
  withFixture(
    {
      "pyproject.toml": [
        "[project]",
        'name = "demo"',
        'dependencies = ["NumPy>=1.26", "scikit-learn"]',
        "[project.optional-dependencies]",
        "dev = [\"pandas ; python_version>'3.9'\"]",
        "[project.scripts]",
        'demo = "demo.cli:main"',
      ].join("\n"),
      "src/demo/__init__.py": "",
      "src/demo/cli.py": "def main(): ...\n",
      "examples/gen.py":
        'import numpy\nimport pandas as pd\nimport requests\n\nif __name__ == "__main__":\n    print(numpy, pd)\n',
    },
    (dir) => {
      const graph = buildGraph(dir);
      const orphans = diagnose(graph)
        .filter((f) => f.kind === "orphan")
        .map((f) => f.file);
      assert.ok(!orphans.includes("examples/gen.py"), "__main__ block = entry");
      assert.ok(
        !orphans.includes("src/demo/cli.py"),
        "[project.scripts] = entry",
      );
      // numpy/pandas are declared deps → external; requests is not → unresolved.
      assert.equal(graph.unresolved, 1);
      assert.equal(graph.external, 2);
      console.log(
        "  ✓ analyze: python __main__/scripts entries, pyproject deps external",
      );
    },
  );
});
