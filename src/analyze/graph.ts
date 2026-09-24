// src/analyze/graph.ts — `buildGraph()`: file-level import graph, computed
// live with Bun.Transpiler.scan() — no new table. Read-only: never writes
// into the analyzed directory.
//
// Same module also serves handoff_check / verification_report: blastRadius()
// (see blast.ts) turns facts.files[] into per-file { dependents, tested } facts.

import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";

import { isBarrelSource } from "./criteria.js";
import { collectSourceFiles } from "./discover.js";
import {
  buildPyModuleIndex,
  PY_STDLIB,
  pyRootSegment,
  resolvePythonImport,
  scanPythonImports,
} from "./python.js";
import { IMPORT_TYPE_RE, REQUIRE_RE, resolveRelative } from "./resolve-ts.js";
import type { ImportGraph } from "./types.js";

export function buildGraph(dir: string): ImportGraph {
  const absDir = resolve(dir);
  const files = collectSourceFiles(absDir);
  const filesSet = new Set(files);
  const deps = new Map<string, Set<string>>();
  const dependents = new Map<string, Set<string>>();
  for (const f of files) dependents.set(f, new Set());
  const barrels = new Set<string>();
  let unresolved = 0;
  let external = 0;
  // Built lazily — a TS-only repo never pays for it.
  let pyIndex: Map<string, string> | null = null;

  const transpiler = new Bun.Transpiler({ loader: "ts" });

  for (const rel of files) {
    let content: string;
    try {
      content = readFileSync(join(absDir, rel), "utf-8");
    } catch {
      unresolved++;
      continue;
    }
    if (isBarrelSource(content, rel)) barrels.add(rel);
    if (rel.endsWith(".py")) {
      // No Transpiler here — it can't parse Python. Relative imports resolve
      // against the importer's package; same-repo absolute imports resolve
      // against the module index. An absolute miss whose root is in PY_STDLIB
      // is external; a third-party package or a real miss stays unresolved.
      pyIndex ??= buildPyModuleIndex(filesSet);
      const pyEdges = new Set<string>();
      for (const imp of scanPythonImports(content)) {
        const hits = resolvePythonImport(rel, imp, filesSet, pyIndex);
        if (hits.size > 0) for (const h of hits) pyEdges.add(h);
        else if (!imp.dots && imp.mod && PY_STDLIB.has(pyRootSegment(imp.mod)))
          external++;
        else unresolved++;
      }
      deps.set(rel, pyEdges);
      continue;
    }
    const raws: string[] = [];
    try {
      const scanned = transpiler.scan(content) as {
        imports: { path: string }[];
      };
      for (const imp of scanned.imports) raws.push(imp.path);
    } catch {
      // Syntax-broken file: skip it, count once — never fail the whole run.
      unresolved++;
      continue;
    }
    // Transpiler.scan blind spots: require() and `import type` are real edges
    // (changing a type still shakes dependents), so pick them up by regex.
    // No overlap with scan output above — scan reports neither form.
    REQUIRE_RE.lastIndex = 0;
    IMPORT_TYPE_RE.lastIndex = 0;
    for (const m of content.matchAll(REQUIRE_RE)) raws.push(m[1]);
    for (const m of content.matchAll(IMPORT_TYPE_RE)) raws.push(m[1]);

    const edges = new Set<string>();
    for (const raw of raws) {
      if (raw.startsWith(".")) {
        const hit = resolveRelative(rel, raw, filesSet);
        if (hit) edges.add(hit);
        else unresolved++;
      } else if (raw.startsWith("node:") || raw.startsWith("bun:")) {
        // A builtin is never an edge between two project files, so it can
        // never be the reason a dependent count came out low. Lumping it in
        // made the warning fire on every repo — 311 of this one's 312 were
        // builtins — and a warning that always fires is not read.
        external++;
      } else {
        // Package name or path alias — out of scope in v1, and unlike a
        // builtin this one CAN be a project edge (`@app/core` in a monorepo).
        unresolved++;
      }
    }
    deps.set(rel, edges);
  }

  for (const [file, edgeSet] of deps) {
    for (const dep of edgeSet) {
      dependents.get(dep)?.add(file);
    }
  }

  return { files, deps, dependents, unresolved, external, barrels };
}
