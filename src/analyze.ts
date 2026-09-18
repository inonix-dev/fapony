// src/analyze.ts — `fapony analyze`: structural health diagnosis for a TS/JS project.
//
// One file on purpose (plan cap: ≤1 new file in src/). Computes a file-level
// import graph live with Bun.Transpiler.scan() — never persisted, no new table.
// Read-only: never writes
// into the analyzed directory.
//
// Same module also serves handoff_check / verification_report: blastRadius()
// turns facts.files[] into per-file { dependents, tested } facts.

import type { Dirent } from "node:fs";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";
import {
  dirname as posixDirname,
  join as posixJoin,
  normalize as posixNormalize,
} from "node:path/posix";

import { extractExports } from "./map.js";

// --- Types (mirror SPEC-analyze-checkup.md) ---

export interface ImportGraph {
  /** Relative POSIX paths scanned. */
  files: string[];
  /** file → files it imports. */
  deps: Map<string, Set<string>>;
  /** file → files that import it (reverse). */
  dependents: Map<string, Set<string>>;
  /** Imports that could not be resolved (bare specifier / alias / builtin). */
  /** Imports that may hide a real edge: relative misses, path aliases, bare
   * package names, and files too broken to read. Worth warning about. */
  unresolved: number;
  /** `node:` / `bun:` builtins — never an edge between two project files, so
   * counting them as "unresolved" only inflates the warning. */
  external: number;
  /** Files that only re-export (`export ... from`) — they hide the real importer. */
  barrels: Set<string>;
}

export type FindingKind =
  | "hub-untested"
  | "orphan"
  | "cycle"
  | "changed-untested";

export interface Finding {
  kind: FindingKind;
  file: string;
  /** Human sentence — the thing people read. */
  detail: string;
  /** How to re-check it yourself (file names, cycle path). */
  evidence: string;
}

export interface BlastEntry {
  dependents: number;
  tested: boolean;
  /** Dependents of dependents, transitively (cycle-safe, excludes the file itself). */
  transitive: number;
}

// BFS over the reverse-edge map — one grep-and-recurse chain collapsed into
// one walk. `seen` makes cycles a no-op instead of an infinite loop.
function transitiveDependentsCount(graph: ImportGraph, file: string): number {
  const seen = new Set<string>();
  let frontier = graph.dependents.get(file) ?? new Set<string>();
  while (frontier.size > 0) {
    const next = new Set<string>();
    for (const f of frontier) {
      if (seen.has(f)) continue;
      seen.add(f);
      for (const dep of graph.dependents.get(f) ?? []) {
        if (!seen.has(dep)) next.add(dep);
      }
    }
    frontier = next;
  }
  // A cycle can walk back to `file` itself — it's not its own dependent.
  seen.delete(file);
  return seen.size;
}

// --- Shared criteria ---

// Same regex collect.ts has always used for test detection — single source of
// truth now (collect.ts imports isTestFile from here). Do NOT diverge.
// Word-boundary aware: "test"/"spec" match only as whole path segments, not as
// substrings of other words (e.g. testing.ts, contest.ts, vitest/ do NOT match).
export const TEST_PATH_RE =
  /(?:^|[/._-])(?:test|spec)(?:$|[/._-])|__tests__|\.test\.|\.spec\./i;

export function isTestFile(p: string): boolean {
  return TEST_PATH_RE.test(p);
}

// A file whose entire body is `export ... from "..."`. Detected because a test
// importing a barrel is still a test importing everything behind it — without
// this, every module under src/db/index.ts or src/stats.ts reads as untested.
const EXPORT_FROM_RE =
  /export\s+(?:\*|\{[^}]*\}|type\s+\*|type\s+\{[^}]*\})(?:\s+as\s+[\w$]+)?\s+from\s*["'][^"']+["']\s*;?/g;

export function isBarrelSource(content: string): boolean {
  const code = content
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^[ \t]*\/\/.*$/gm, "");
  if (!/\bexport\b/.test(code)) return false;
  EXPORT_FROM_RE.lastIndex = 0;
  return code.replace(EXPORT_FROM_RE, "").trim() === "";
}

// Is any test file an importer of `file`, walking *through* barrels only?
// Barrels can nest (db/*.ts → db/index.ts → db.ts), so recurse, but never
// through a normal module — that would make every file in a tested repo
// count as tested and kill the signal entirely.
export function isTestedThroughBarrels(
  graph: ImportGraph,
  file: string,
  seen = new Set<string>(),
): boolean {
  if (seen.has(file)) return false;
  seen.add(file);
  for (const dep of graph.dependents.get(file) ?? []) {
    if (isTestFile(dep)) return true;
    if (graph.barrels.has(dep) && isTestedThroughBarrels(graph, dep, seen))
      return true;
  }
  return false;
}

export const SCAN_EXTS = new Set([".ts", ".tsx", ".js", ".jsx"]);

// Always skipped, hardcoded — no config (per plan: no .faponyignore in v1).
const SKIP_DIRS = new Set(["node_modules", "dist", "build", ".git"]);

// A nested checkout (clone or `git worktree add`) is a different project that
// happens to live inside this one — walking it doubles the graph and makes every
// single-directory pattern look like it repeats across two. `parentDir` is
// required so this can be detected rather than guessed from the name: prefixes
// like `wt-`/`cl-` are one person's convention, `.git` is the actual invariant
// (a dir for a clone, a file for a worktree — existsSync covers both).
export function isSkippedDir(name: string, parentDir: string): boolean {
  if (SKIP_DIRS.has(name)) return true;
  return existsSync(join(parentDir, name, ".git"));
}

function isEntryPoint(rel: string): boolean {
  const base = rel.slice(rel.lastIndexOf("/") + 1);
  return base === "fapony.ts" || base === "index.ts";
}

// --- File discovery (manual walk, not Bun.Glob) ---

export function collectSourceFiles(
  absDir: string,
  opts?: { skipHidden?: boolean },
): string[] {
  const out: string[] = [];
  const stack: string[] = [absDir];
  while (stack.length > 0) {
    const dir = stack.pop() as string;
    let entries: Dirent[];
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      continue; // unreadable dir → skip, never throw
    }
    for (const e of entries) {
      // Never follow symlinks — loop-proof without extra code.
      if (e.isSymbolicLink()) continue;
      if (e.isDirectory()) {
        if (isSkippedDir(e.name, dir)) continue;
        if (opts?.skipHidden && e.name.startsWith(".")) continue;
        stack.push(join(dir, e.name));
      } else if (e.isFile()) {
        const dot = e.name.lastIndexOf(".");
        if (dot >= 0 && SCAN_EXTS.has(e.name.slice(dot))) {
          out.push(relative(absDir, join(dir, e.name)).split(sep).join("/"));
        }
      }
    }
  }
  return out.sort();
}

// --- Import resolution ---

const REQUIRE_RE = /\brequire\(\s*["']([^"']+)["']\s*\)/g;
const IMPORT_TYPE_RE = /\bimport\s+type\s+[^;]*?\bfrom\s*["']([^"']+)["']/g;

const RESOLVE_EXTS = [".ts", ".tsx", ".js", ".jsx"];

function resolveRelative(
  importerRel: string,
  raw: string,
  filesSet: Set<string>,
): string | null {
  const base = posixNormalize(posixJoin(posixDirname(importerRel), raw));
  const candidates = new Set<string>([base, `${base}/index.ts`]);
  for (const e of RESOLVE_EXTS) candidates.add(base + e);
  // TS files import the compiled path ("./foo.js") — try the stem too.
  const dot = base.lastIndexOf(".");
  if (dot > base.lastIndexOf("/")) {
    const stem = base.slice(0, dot);
    for (const e of RESOLVE_EXTS) candidates.add(stem + e);
    candidates.add(`${stem}/index.ts`);
  }
  for (const c of candidates) {
    if (filesSet.has(c)) return c;
  }
  return null;
}

// --- Exports, seen through barrels ---

// `export * from "./x"` is reported by Bun.Transpiler.scan as an IMPORT edge and
// never as an export, so a barrel file scans as having zero exports. Measured on
// vela 2026-09-18: 211 barrels out of 1,996 source files, and `@innominix/ui`
// alone is imported 462 times — the blind spot hides most of the cross-package
// graph, which is why a wrapper reached through a barrel reads as unused. Named
// re-exports (`export { x } from "./y"`) are already reported correctly; only the
// star form needs this. Cost to close it: 1.9ms on a 17-export barrel. tsc answers
// the same question type-accurately for 2,176ms — see SPEC-convention-debt.md §2.2
// for why that 1,145x is not worth paying here.
const STAR_REEXPORT_RE =
  /^[ \t]*export\s+\*\s+(?:as\s+[\w$]+\s+)?from\s*["'](\.[^"']+)["']/gm;

export function exportsThroughBarrels(
  absDir: string,
  rel: string,
  filesSet: Set<string>,
  seen = new Set<string>(),
): string[] {
  if (seen.has(rel)) return []; // barrels re-export each other; stop the cycle
  seen.add(rel);
  let source: string;
  try {
    source = readFileSync(join(absDir, rel), "utf-8");
  } catch {
    return [];
  }
  const out = extractExports(source)
    .symbols.filter((s) => s.name !== "*")
    .map((s) => s.name);
  STAR_REEXPORT_RE.lastIndex = 0;
  for (const m of source.matchAll(STAR_REEXPORT_RE)) {
    const hit = resolveRelative(rel, m[1], filesSet);
    if (hit) out.push(...exportsThroughBarrels(absDir, hit, filesSet, seen));
  }
  return [...new Set(out)];
}

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

  const transpiler = new Bun.Transpiler({ loader: "ts" });

  for (const rel of files) {
    let content: string;
    try {
      content = readFileSync(join(absDir, rel), "utf-8");
    } catch {
      unresolved++;
      continue;
    }
    if (isBarrelSource(content)) barrels.add(rel);
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

// --- Diagnosis ---

function findCycles(graph: ImportGraph): string[][] {
  const cycles: string[][] = [];
  const seen = new Set<string>();
  const color = new Map<string, number>(); // 1 = on stack, 2 = done
  const stack: string[] = [];

  function visit(node: string): void {
    if (cycles.length >= 20) return; // bound work, display caps at 5 anyway
    color.set(node, 1);
    stack.push(node);
    for (const next of graph.deps.get(node) ?? []) {
      if (cycles.length >= 20) break;
      const c = color.get(next) ?? 0;
      if (c === 1) {
        const cycle = stack.slice(stack.indexOf(next));
        const key = [...cycle].sort().join("|");
        if (!seen.has(key)) {
          seen.add(key);
          cycles.push(cycle);
        }
      } else if (c === 0) {
        visit(next);
      }
    }
    stack.pop();
    color.set(node, 2);
  }

  for (const f of graph.files) {
    if ((color.get(f) ?? 0) === 0) visit(f);
  }
  return cycles;
}

const KIND_RANK: Record<FindingKind, number> = {
  cycle: 0,
  "hub-untested": 1,
  "changed-untested": 2,
  orphan: 3,
};

export function diagnose(
  graph: ImportGraph,
  changed: string[] = [],
): Finding[] {
  const findings: Finding[] = [];
  const filesSet = new Set(graph.files);

  for (const cycle of findCycles(graph)) {
    findings.push({
      kind: "cycle",
      file: cycle.join(" ↔ "),
      detail: "import วนกลับหากัน — refactor ฝั่งไหนก่อนก็พังอีกฝั่ง",
      evidence: [...cycle, cycle[0]].join(" → "),
    });
  }

  const hubUntested: { file: string; n: number }[] = [];
  for (const f of graph.files) {
    const deps = graph.dependents.get(f) ?? new Set<string>();
    if (deps.size === 0) {
      if (!isEntryPoint(f) && !isTestFile(f)) {
        findings.push({
          kind: "orphan",
          file: f,
          detail: "ไม่มีใคร import และไม่ใช่ entry point — dead code candidate",
          evidence: "0 dependents",
        });
      }
    } else if (deps.size >= 3 && !isTestedThroughBarrels(graph, f)) {
      hubUntested.push({ file: f, n: deps.size });
    }
  }
  hubUntested.sort((a, b) => b.n - a.n || (a.file < b.file ? -1 : 1));
  for (const { file, n } of hubUntested) {
    const deps = [...(graph.dependents.get(file) ?? [])].sort();
    const shown = deps.slice(0, 3).join(", ");
    const rest = n > 3 ? ` … (+${n - 3})` : "";
    findings.push({
      kind: "hub-untested",
      file,
      detail: `${n} ไฟล์พึ่งอยู่ ไม่มีเทสไหน import มันเลย — แก้ตรงนี้ไม่มีอะไรจับตอนพัง`,
      evidence: `พึ่งอยู่: ${shown}${rest}`,
    });
  }

  for (const c of changed) {
    if (!filesSet.has(c)) continue;
    const deps = graph.dependents.get(c) ?? new Set<string>();
    if (!isTestedThroughBarrels(graph, c)) {
      findings.push({
        kind: "changed-untested",
        file: c,
        detail: `เพิ่งแก้แต่ไม่มีเทสไหนพึ่งอยู่ (${deps.size} dependent) — พังแล้วไม่มีอะไรจับ`,
        evidence:
          deps.size > 0
            ? `พึ่งอยู่: ${[...deps].sort().join(", ")}`
            : "0 dependents",
      });
    }
  }

  findings.sort((a, b) => KIND_RANK[a.kind] - KIND_RANK[b.kind]);
  return findings;
}

// --- Blast radius (for handoff_check / verification_report) ---

export function blastRadius(
  graph: ImportGraph,
  files: string[],
): Record<string, BlastEntry> {
  const out: Record<string, BlastEntry> = {};
  for (const f of files) {
    const deps = graph.dependents.get(f) ?? new Set<string>();
    out[f] = {
      dependents: deps.size,
      tested: isTestedThroughBarrels(graph, f),
      transitive: transitiveDependentsCount(graph, f),
    };
  }
  return out;
}

// Convenience for the MCP tools: graph the worktree live, map files[] to
// blast radius. Null when there is nothing to map or the dir is unreadable —
// callers render "no blast data", never throw.
export function blastRadiusForWorktree(
  worktree: string,
  files: string[],
): Record<string, BlastEntry> | null {
  if (files.length === 0) return null;
  try {
    return blastRadius(buildGraph(worktree), files);
  } catch {
    return null;
  }
}

// --- CLI rendering (plain text only — no ANSI, pipes cleanly) ---

export function formatAnalyze(graph: ImportGraph, findings: Finding[]): string {
  let imports = 0;
  for (const s of graph.deps.values()) imports += s.size;
  const lines: string[] = [];
  lines.push(
    `fapony analyze — ${graph.files.length} files scanned (.ts/.tsx/.js/.jsx), ${imports} imports, ${graph.external} builtin, ${graph.unresolved} unresolved`,
  );
  lines.push("");

  if (findings.length === 0) {
    lines.push("no findings — โครงสร้างไม่มีอะไรน่าห่วง");
  } else {
    for (const f of findings.slice(0, 5)) {
      const icon = f.kind === "orphan" ? "·" : "⚠";
      lines.push(`  ${icon}  ${f.file}`);
      lines.push(`     ${f.detail}`);
      lines.push(`     ${f.evidence}`);
      lines.push("");
    }
    const rest = findings.length - Math.min(findings.length, 5);
    if (rest > 0) lines.push(`… and ${rest} more`);
    lines.push(
      graph.unresolved > 0
        ? `${findings.length} findings. ${graph.unresolved} unresolved imports (path alias / package name) — ตัวเลข dependent อาจต่ำกว่าจริง`
        : `${findings.length} findings.`,
    );
  }
  return lines.join("\n");
}

// --- CLI entry ---

export function cmdAnalyze(args: string[]): void {
  const dir = args[0] ?? ".";
  const absDir = resolve(dir);
  if (!existsSync(absDir)) {
    console.error(`fapony analyze: "${dir}" does not exist`);
    process.exit(1);
  }
  let graph: ImportGraph;
  try {
    graph = buildGraph(absDir);
  } catch (e) {
    console.error(
      `fapony analyze: cannot scan "${dir}": ${e instanceof Error ? e.message : String(e)}`,
    );
    process.exit(1);
  }
  console.log(formatAnalyze(graph, diagnose(graph)));
}
