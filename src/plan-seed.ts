// src/plan-seed.ts — `fapony plan-seed <name> [--spec] [--scope <path>]...`
//
// Writes PLAN + SPEC straight into planDir/specDir, with the factual sections
// pre-filled from map/analyze/mem/ledger. §2 reports what REPEATS across the
// scope's exports (a directory listing is the one thing Glob gives the agent
// for free); §5 carries analyze findings scoped to the requested paths. Every
// section is hard-capped review-seed style — PLAN ≤ ~60 and SPEC ≤ 200 lines
// are the contract (PLAN-seed-scope-and-cap §3, measured against an 18,175-
// line SPEC innominix deleted by hand). The agent is left with judgment only.
// init-family: writes only the files the user asked for, inside planDir/
// specDir — never runtime state (that stays in ~/.config/fapony/).
// Deterministic: same input, same output, no LLM call.
//
// Composes existing producers — no new parsing, no new table, no MCP tool.

import { execSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, join, relative, resolve, sep } from "node:path";
import {
  buildGraph,
  collectSourceFiles,
  diagnose,
  type Finding,
  type FindingKind,
  isSkippedDir,
  SCAN_EXTS,
} from "./analyze.js";
import { computeModelFit } from "./context/projectHealth.js";
import { doneDir, planDir, specDir } from "./db/getters.js";
import { loadConfig } from "./db/load.js";
import type { Config } from "./db/types.js";
import { extractExports } from "./map.js";
import { readRecentMemDecisions } from "./memory.js";
import { parseNumstat, untrackedFiles } from "./review-seed.js";
import { getStatsData } from "./stats/data.js";

// One chunk = one module's signatures — past ~40 lines a module is its own
// reading task, and the whole-SPEC cap below does the final trim.
const MAX_CHUNK_LINES = 40;
// The whole-SPEC contract (§3.1): whatever the scope, the file stays ≤ 200.
const MAX_SPEC_LINES = 200;
// Above this many files in scope the caps start eating output silently —
// warn so the shortness is explained. (guess — first cutoff that felt right)
const SCOPE_WARN_FILES = 300;
// The plan is a starting position, not a contract — cap §5 at the worst findings.
const MAX_RISKS = 5;

// Shipped plans/specs that already touched this scope. Capped low on purpose:
// this is a "go read that first" pointer, not a bibliography.
const MAX_PRIOR_ART = 5;
const SIG_MAX = 90;
// Anchor-safe slug: lowercase, non-alphanumerics → dash.
const slug = (s: string): string =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");

// --- §2 Repetition — what repeats, not what exists ---
// A directory listing is free (Glob); what repeats across many files costs
// real reads to notice. Tokenize export names camelCase, group by the FIRST
// token, report clusters of ≥ 3 members and never judge them: whether a
// cluster is duplication is the agent's call.
//
// Cross-directory only. A cluster inside ONE directory is the naming
// convention of that directory (`get*` × 12 in src/db/ says getters are
// called get), and reporting it spends the plan's §2 budget telling the
// reader a rule they can see from the folder name. The same token showing up
// in two directories is the thing worth a look. Threshold + full member list
// are the escape hatches (PLAN §5).

const REPETITION_MIN = 3;
const REPETITION_MIN_DIRS = 2;
const MAX_CLUSTER_DIRS = 3;
const MAX_CLUSTERS = 5;

function camelTokens(name: string): string[] {
  return name
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean)
    .map((t) => t.toLowerCase());
}

// Absolute source files under a scope root. A single-file scope counts as
// itself — collectSourceFiles only walks dirs, so a file root would vanish.
function scopeSourceFiles(root: string): string[] {
  let st: import("node:fs").Stats;
  try {
    st = statSync(root);
  } catch {
    return [];
  }
  if (!st.isDirectory()) {
    return isSourceFile(st, basename(root)) ? [root] : [];
  }
  return collectSourceFiles(root, { skipHidden: true }).map((rel) =>
    join(root, rel),
  );
}

function renderScope(
  roots: string[],
  filesByRoot: Map<string, string[]>,
  cwd: string,
): string {
  const byToken = new Map<string, { names: Set<string>; dirs: Set<string> }>();
  let files = 0;
  let exports = 0;
  for (const root of roots) {
    for (const abs of filesByRoot.get(root) ?? []) {
      let source: string;
      try {
        source = readFileSync(abs, "utf-8");
      } catch {
        continue;
      }
      const scan = extractExports(source);
      if (scan.error) continue;
      files++;
      exports += scan.symbols.length;
      const dir = dirname(relative(cwd, abs)) || ".";
      for (const s of scan.symbols) {
        const head = camelTokens(s.name)[0];
        if (!head) continue;
        let cluster = byToken.get(head);
        if (!cluster) {
          cluster = { names: new Set<string>(), dirs: new Set<string>() };
          byToken.set(head, cluster);
        }
        cluster.names.add(s.name);
        cluster.dirs.add(dir);
      }
    }
  }
  const lines = [
    `- scanned: ${roots.map((r) => relative(cwd, r) || ".").join(", ")} — ${files} file(s), ${exports} export(s) \`(fapony map)\``,
  ];
  const clusters = [...byToken.entries()]
    .filter(
      ([, c]) =>
        c.names.size >= REPETITION_MIN && c.dirs.size >= REPETITION_MIN_DIRS,
    )
    .map(([token, c]) => ({
      token,
      members: [...c.names].sort(),
      dirs: [...c.dirs].sort(),
    }))
    .sort(
      (a, b) =>
        b.dirs.length - a.dirs.length ||
        b.members.length - a.members.length ||
        (a.token < b.token ? -1 : 1),
    );
  if (clusters.length === 0) {
    lines.push(
      `_(no export-name prefix repeating across ${REPETITION_MIN_DIRS}+ directories — nothing here but each directory's own naming convention)_`,
    );
    return lines.join("\n");
  }
  for (const c of clusters.slice(0, MAX_CLUSTERS)) {
    // Members are never dropped (they are the finding); the directory list is
    // context, so it is the one that gets cut — always saying how much.
    const shown = c.dirs.slice(0, MAX_CLUSTER_DIRS).join(", ");
    const where =
      c.dirs.length > MAX_CLUSTER_DIRS
        ? `${shown} +${c.dirs.length - MAX_CLUSTER_DIRS} more`
        : shown;
    lines.push(
      `- ${c.token}* — ${c.members.length} export(s) across ${where}: ${c.members.join(", ")} \`(fapony map)\``,
    );
  }
  if (clusters.length > MAX_CLUSTERS) {
    lines.push(
      `- … +${clusters.length - MAX_CLUSTERS} more clusters (narrow with --scope)`,
    );
  }
  return lines.join("\n");
}

// --- Risks (§5) from analyze findings ---

// §5 order — the finding tied to the work about to happen leads. analyze's own
// KIND_RANK leads with cycles; a plan reads top-down, so changed-first here.
const RISK_KINDS: FindingKind[] = [
  "changed-untested",
  "hub-untested",
  "cycle",
  "orphan",
];

// Changed files (diff HEAD + untracked), repo-root-relative — the same two
// declared git calls review-seed makes. This is what makes changed-untested
// findings possible at all; without it §5 lost the one finding tied to the
// work this plan is about to do. Git failures (not a repo, detached oddities)
// degrade to "no changed files", never a throw.
function gitChangedFiles(repoRoot: string): string[] {
  const run = (cmd: string): string => {
    try {
      return execSync(cmd, {
        cwd: repoRoot,
        encoding: "utf-8",
        stdio: ["pipe", "pipe", "pipe"],
        timeout: 15_000,
      });
    } catch {
      return "";
    }
  };
  return [
    ...parseNumstat(run("git diff HEAD --numstat -M")).map((e) => e.path),
    ...untrackedFiles(run("git status --porcelain -uall")).map((e) => e.path),
  ];
}

// The overwrite check catches a filename collision. It does not catch the
// expensive mistake: planning again what a shipped plan already decided —
// PLAN-cost-per-pass froze the tokens/pass formula, and a later seed over
// src/stats gave no hint it existed. Scope paths are the join key: a shipped
// plan that names this directory decided something about the code this seed
// is about to plan. Headers only (title + shipped date) — pulling the bodies
// in would recreate the reading task the plan exists to avoid.
function renderPriorArt(cwd: string, config: Config, roots: string[]): string {
  const placeholder = "- _(agent เติม)_";
  const keys = roots
    .map((r) => relative(cwd, r))
    .filter((r) => r !== "" && r !== ".");
  // No --scope means every shipped plan matches — a list of everything points
  // at nothing.
  if (keys.length === 0) return placeholder;

  const hits: { shipped: string; line: string }[] = [];
  for (const dir of [doneDir(config), specDir(config)]) {
    const abs = join(cwd, dir);
    let names: string[];
    try {
      names = readdirSync(abs)
        .filter((n) => n.endsWith(".md"))
        .sort();
    } catch {
      continue; // dir missing — a repo without shipped plans yet
    }
    const label = dir.split("/").pop() ?? dir;
    for (const n of names) {
      let content: string;
      try {
        content = readFileSync(join(abs, n), "utf-8");
      } catch {
        continue;
      }
      if (!keys.some((k) => content.includes(k))) continue;
      // The H1 usually repeats the filename ("PLAN-x.md — real title") and
      // the filename is already the link text — keep only what it adds.
      const title = (content.match(/^#\s+(.+)$/m)?.[1] ?? n)
        .trim()
        .replace(/^(?:PLAN|SPEC)-[\w.-]+\s+[—-]\s+/, "");
      const shipped = content.match(/shipped\s+(\d{4}-\d{2}-\d{2})/)?.[1] ?? "";
      hits.push({
        shipped,
        line: `- ✅ ตัดสินไปแล้ว: [${n}](../${label}/${n}) — ${title}${shipped ? ` (shipped ${shipped})` : ""} \`(fapony plan-seed)\``,
      });
    }
  }
  if (hits.length === 0) return placeholder;
  // Newest decision first — alphabetical order cuts by filename, which is the
  // one thing that says nothing about whether the decision still binds.
  // Undated (specs, unshipped) sort last rather than disappearing.
  hits.sort((a, b) =>
    a.shipped < b.shipped ? 1 : a.shipped > b.shipped ? -1 : 0,
  );
  const shown = hits.slice(0, MAX_PRIOR_ART).map((h) => h.line);
  if (hits.length > MAX_PRIOR_ART) {
    shown.push(`- … +${hits.length - MAX_PRIOR_ART} more ที่แตะ scope เดียวกัน`);
  }
  shown.push(placeholder);
  return shown.join("\n");
}

function renderRisks(scanBase: string, roots: string[]): string {
  let findings: Finding[];
  try {
    findings = diagnose(buildGraph(scanBase), gitChangedFiles(scanBase));
  } catch {
    return "_(analyze failed to scan this tree — run `fapony analyze` manually)_";
  }
  // Findings outside the scope are another plan's problem — a seed for
  // apps/vela/src/layouts/quick must not carry apps/mdl's findings. Cycle
  // rows join their members with " ↔ ", so any member in scope keeps the row.
  const inScope = (rel: string): boolean => {
    const abs = resolve(scanBase, rel);
    return roots.some((r) => abs === r || abs.startsWith(`${r}${sep}`));
  };
  const scoped = findings.filter((f) => f.file.split(" ↔ ").some(inScope));
  if (scoped.length === 0) {
    // Never "nothing is wrong": analyze judges whole files (hub / orphan /
    // cycle / changed-untested) and cannot see an export nobody calls, because
    // one re-export keeps its file reachable. Silence read as a clean bill is
    // what makes a seeded §5 more dangerous than an empty one.
    return "no findings — analyze ดูระดับไฟล์ (hub/orphan/cycle/changed-untested) ไม่เห็น export ที่ไม่มีคนเรียก `(fapony analyze)`";
  }
  const ordered = scoped.sort(
    (a, b) =>
      RISK_KINDS.indexOf(a.kind) - RISK_KINDS.indexOf(b.kind) ||
      (a.file < b.file ? -1 : 1),
  );
  const lines = ordered.slice(0, MAX_RISKS).map((f) => {
    const icon = f.kind === "orphan" ? "·" : "⚠";
    return `- ${icon} **${f.kind}** ${f.file} — ${f.detail} \`(fapony analyze)\``;
  });
  if (ordered.length > MAX_RISKS) {
    lines.push(
      `- … +${ordered.length - MAX_RISKS} more (run \`fapony analyze\` for the full list)`,
    );
  }
  return lines.join("\n");
}

// --- Context (fapony): mem decisions + model fit ---

function renderContextFapony(worktree: string): string {
  const lines: string[] = [];
  const decisions = readRecentMemDecisions(worktree, 3).slice(0, 3);
  lines.push(
    decisions.length > 0
      ? `- Decisions on record (mem): ${decisions
          .map(
            (d) =>
              `"${d.text.length > 140 ? `${d.text.slice(0, 139)}…` : d.text}"`,
          )
          .join(" · ")}`
      : "- Decisions on record (mem): _(none — no mem log or empty)_",
  );
  const fits = computeModelFit(getStatsData().byRegime, worktree);
  lines.push(
    fits.length > 0
      ? `- Model fit (ledger, min N=5): ${fits
          .map(
            (f) =>
              `${f.regime} → ${f.model} (N=${f.gates}, fail ${(f.failRate * 100).toFixed(0)}%)`,
          )
          .join(" · ")}`
      : "- Model fit: _(not enough graded history yet)_",
  );
  return lines.join("\n");
}

// --- PLAN barrel ---

function planTemplate(
  name: string,
  scope: string,
  risks: string,
  priorArt: string,
  contextFapony: string,
  specLink: string | null,
): string {
  return `---
kind: unit
status: active
---

# PLAN-${name} — (agent เติมชื่อเรื่อง)

> **Status:** 🚧 in-progress · **Created:** (agent เติมวันที่)

## TL;DR
- **What:** (agent เติม) · **Why:** (agent เติม) · **Done when:** (agent เติม)
- **Order:** (agent เติม)
- **Progress:**
  - [ ] chunk 1 — (agent เติม)

## 1. Goal (why)
_(agent เติม)_

## 2. Scope — what repeats
${scope}

## 3. Done criteria (how we know it's finished)
_(agent เติม — ต้อง verify ได้)_

## 4. Constraints / Hard rules (must not violate)
_(agent เติม)_

## 5. Risks — from the import graph
${risks}

## 6. Steps (what in which order)
1. _(agent เติม — แต่ละขั้น verify ได้)_

## 7. Examples
${
  specLink
    ? `→ ${specLink}  (signature อยู่ spec ไม่ใช่ plan)`
    : "_(agent เติม — หรือเพิ่ม SPEC ด้วย plan-seed --spec)_"
}

## 8. References
${priorArt}

## Context (agent)
_(slot ว่าง — agent dump graph/code-summary ของตัวเอง)_

## Context (fapony)
${contextFapony}
`;
}

// --- SPEC chunked (--spec) ---
// One chunk per module (top-level dir, recursed), verbatim declaration
// signatures per file inside — the exact thing plan §7 must not hold.

interface Chunk {
  slug: string;
  title: string;
  body: string;
}

// review-seed's cap shape: keep the head, always say how much was cut — a
// silent cut is indistinguishable from "that was everything".
function capLines(lines: string[], cap: number, what: string): string[] {
  if (lines.length <= cap) return lines;
  const rest = lines.length - (cap - 1);
  const kept = lines.slice(0, cap - 1);
  kept.push(`… +${rest} more ${what}`);
  return kept;
}

function capChunk(c: Chunk): Chunk {
  return {
    ...c,
    body: capLines(
      c.body.split("\n"),
      MAX_CHUNK_LINES,
      "signatures (narrow with --scope <path>)",
    ).join("\n"),
  };
}

function fileLines(absFile: string): string[] {
  let source: string;
  try {
    source = readFileSync(absFile, "utf-8");
  } catch {
    return ["_(unreadable)_"];
  }
  const scan = extractExports(source);
  if (scan.error) return [`⚠ ${scan.error} — symbols not extractable`];
  if (scan.symbols.length === 0) return ["_(no exports)_"];
  let srcLines: string[] = [];
  try {
    srcLines = source.split("\n");
  } catch {
    // fall through to name-only below
  }
  return scan.symbols.map((s) => {
    const raw = srcLines[s.line - 1]?.trim() ?? "";
    const sig = raw.length > SIG_MAX ? `${raw.slice(0, SIG_MAX - 1)}…` : raw;
    return `  - \`${s.line}\`  ${s.kind}  ${sig || s.name}`;
  });
}

function isSourceFile(st: { isDirectory(): boolean }, name: string): boolean {
  return !st.isDirectory() && SCAN_EXTS.has(name.slice(name.lastIndexOf(".")));
}

function moduleChunkFiles(absDir: string, entries: string[]): string[] {
  const lines: string[] = [];
  for (const name of entries) {
    const child = join(absDir, name);
    let st: import("node:fs").Stats;
    try {
      st = statSync(child);
    } catch {
      continue;
    }
    if (isSourceFile(st, name)) {
      lines.push(`### ${name}`, "", ...fileLines(child), "");
    }
  }
  return lines;
}

function moduleChunk(absDir: string, rel: string): Chunk | null {
  let entries: string[];
  try {
    entries = readdirSync(absDir, { withFileTypes: true })
      .filter(
        (e) =>
          !e.isSymbolicLink() &&
          !e.name.startsWith(".") &&
          !isSkippedDir(e.name, absDir),
      )
      .map((e) => e.name)
      .sort();
  } catch {
    return null;
  }
  const lines: string[] = moduleChunkFiles(absDir, entries);
  for (const name of entries) {
    const child = join(absDir, name);
    let st: import("node:fs").Stats;
    try {
      st = statSync(child);
    } catch {
      continue;
    }
    if (!st.isDirectory()) continue;
    const nested = moduleChunk(child, `${rel}/${name}`);
    if (nested) lines.push(`**${name}/**`, "", nested.body, "");
  }
  if (lines.length === 0) return null;
  return { slug: slug(rel), title: rel, body: lines.join("\n").trimEnd() };
}

// One scope root = root files first, then one chunk per top-level dir. When the
// root is a single file, produce one chunk for it (readdirSync on a file throws,
// so handle it before the dir walk).
function rootChunks(absDir: string): Chunk[] {
  const chunks: Chunk[] = [];
  let st: import("node:fs").Stats;
  try {
    st = statSync(absDir);
  } catch {
    return chunks;
  }
  if (!st.isDirectory()) {
    // Single-file scope: one chunk, the file's own signatures.
    const name = basename(absDir);
    if (!isSourceFile(st, name)) return chunks;
    const lines = fileLines(absDir);
    if (lines.length === 0) return chunks;
    return [
      capChunk({
        slug: slug(name),
        title: name,
        body: lines.join("\n"),
      }),
    ];
  }
  let entries: string[] = [];
  try {
    entries = readdirSync(absDir, { withFileTypes: true })
      .filter(
        (e) =>
          !e.isSymbolicLink() &&
          !e.name.startsWith(".") &&
          !isSkippedDir(e.name, absDir),
      )
      .map((e) => e.name)
      .sort();
  } catch {
    return chunks;
  }
  const rootLines = moduleChunkFiles(absDir, entries);
  if (rootLines.length > 0) {
    chunks.push(
      capChunk({
        slug: "root",
        title: "(root files)",
        body: rootLines.join("\n").trimEnd(),
      }),
    );
  }
  for (const name of entries) {
    const child = join(absDir, name);
    let st: import("node:fs").Stats;
    try {
      st = statSync(child);
    } catch {
      continue;
    }
    if (!st.isDirectory()) continue;
    const c = moduleChunk(child, name);
    if (c) chunks.push(capChunk(c));
  }
  return chunks;
}

// Chunk titles/slugs are unique per scope root — with more than one root,
// prefix them so "src" from two different scopes doesn't collide.
function buildChunks(roots: string[], cwd: string): Chunk[] {
  const chunks: Chunk[] = [];
  const multi = roots.length > 1;
  for (const root of roots) {
    const rel = relative(cwd, root) || ".";
    for (const c of rootChunks(root)) {
      chunks.push(
        multi
          ? {
              slug: slug(`${rel}-${c.slug}`),
              title:
                c.title === "(root files)"
                  ? `${rel}/ (root files)`
                  : `${rel}/${c.title}`,
              body: c.body,
            }
          : c,
      );
    }
  }
  return chunks;
}

function specTemplate(
  name: string,
  chunks: Chunk[],
  scopeEcho: string | null,
): string {
  const index = chunks.map((c) => `- [${c.title}](#${c.slug})`).join("\n");
  // The index is one string with a newline per chunk; budgeting it as one line
  // undershot the cap by that many lines (the 18k-SPEC failure mode). Cap the
  // index separately so the body's capLines has a bounded head to work with.
  const fixedHead = [
    `# SPEC-${name} — (agent เติมชื่อเรื่อง)`,
    "",
    `> **Used by:** PLAN-${name} — signatures below come from \`fapony map <file>\` (live scan — re-seed after structural changes).`,
    ...(scopeEcho ? [`> **Scope:** ${scopeEcho}`] : []),
    "",
    "## Chunk index",
    "",
  ];
  const indexLines = index
    ? index.split("\n")
    : ["_(no chunks — no source files found)_"];
  const budgetIndex = Math.max(MAX_SPEC_LINES - fixedHead.length - 1, 0);
  const cappedIndex = capLines(
    indexLines,
    budgetIndex,
    "chunks (narrow with --scope <path>)",
  );
  const head = [...fixedHead, ...cappedIndex, ""];
  const tail = [
    "## (agent เติม — wireframes / edge cases / API shapes ที่ plan อ้างถึง)",
  ];
  const bodyLines = chunks.flatMap((c) => [
    `## <a id="${c.slug}"></a>${c.title}`,
    "",
    ...c.body.split("\n"),
    "",
  ]);
  // Whole-file cap runs last and the agent section survives it, same way
  // review-seed reserves its disclaimer: reserve the tail, cut the middle,
  // say how much was dropped.
  const budget = Math.max(MAX_SPEC_LINES - head.length - tail.length, 0);
  const cappedBody = capLines(
    bodyLines,
    budget,
    "lines (narrow with --scope <path>)",
  );
  return `${[...head, ...cappedBody, ...tail].join("\n")}\n`;
}

// --- CLI entry ---

export function cmdPlanSeed(args: string[]): void {
  const usage = "usage: fapony plan-seed <name> [--spec] [--scope <path>]...";
  // Positional parse, not args.find(!startsWith("--")) — a --scope VALUE is
  // a non-flag argument and must never be mistaken for the plan name.
  let name: string | undefined;
  let withSpec = false;
  const scopeArgs: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--spec") {
      withSpec = true;
    } else if (a === "--scope") {
      const v = args[i + 1];
      if (v === undefined || v.startsWith("--")) {
        console.error(`plan-seed: --scope needs a path\n${usage}`);
        process.exit(1);
      }
      scopeArgs.push(v);
      i++;
    } else if (a.startsWith("--")) {
      console.error(`plan-seed: unknown flag "${a}"\n${usage}`);
      process.exit(1);
    } else if (name === undefined) {
      name = a;
    }
  }
  if (!name) {
    console.error(usage);
    process.exit(1);
  }
  const cwd = process.cwd();
  const config = loadConfig(join(cwd, "fapony.config.json"));
  // Resolve the git worktree root so mem/ledger queries hit the same key
  // state.db uses (git rev-parse --show-toplevel). Running from a subdir
  // would otherwise mismatch: stats return empty, Context (fapony) always
  // prints "(not enough graded history yet)".
  let worktree: string;
  try {
    worktree = execSync("git rev-parse --show-toplevel", {
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
    }).trim();
  } catch {
    worktree = cwd;
  }

  // Scope: explicit paths win; default is the cwd. Resolved absolutes,
  // deduped — the same path twice is one scope. Nested roots are pruned:
  // --scope src --scope src/utils would double-count files in src/utils.
  const requested = [...new Set(scopeArgs.map((s) => resolve(cwd, s)))];
  // Sort by path length (shortest first) so a parent always comes before its
  // children; then drop any root whose ancestor is already in the list.
  requested.sort((a, b) => a.length - b.length);
  const roots: string[] = [];
  for (const r of requested) {
    if (roots.some((accepted) => r.startsWith(`${accepted}${sep}`))) continue;
    roots.push(r);
  }
  for (const r of roots) {
    if (!existsSync(r)) {
      console.error(`plan-seed: scope not found: ${r}`);
      process.exit(1);
    }
  }
  if (roots.length === 0) roots.push(resolve(cwd, "."));
  // Past a few hundred files the caps start eating output — say why it looks
  // short instead of letting the seed silently truncate. 300 is a guess. Walk
  // the scope once here; renderScope reuses the result without a second walk.
  const filesByRoot = new Map<string, string[]>();
  let totalFiles = 0;
  for (const r of roots) {
    const files = scopeSourceFiles(r);
    filesByRoot.set(r, files);
    totalFiles += files.length;
  }
  if (totalFiles > SCOPE_WARN_FILES) {
    console.error(
      `plan-seed: ${totalFiles} source files in scope (> ${SCOPE_WARN_FILES}) — output is capped; narrow with --scope <path>`,
    );
  }

  const planDirAbs = join(cwd, planDir(config));
  const planPath = join(planDirAbs, `PLAN-${name}.md`);
  if (existsSync(planPath)) {
    console.error(
      `${planPath} already exists — not overwriting. ใช้ชื่อใหม่ เช่น PLAN-${name}-v2`,
    );
    process.exit(1);
  }

  const scope = renderScope(roots, filesByRoot, cwd);
  const risks = renderRisks(worktree, roots);
  const priorArt = renderPriorArt(cwd, config, roots);
  const contextFapony = renderContextFapony(worktree);

  let specLink: string | null = null;
  if (withSpec) {
    const specDirAbs = join(cwd, specDir(config));
    const specPath = join(specDirAbs, `SPEC-${name}.md`);
    if (existsSync(specPath)) {
      console.error(
        `${specPath} already exists — not overwriting. ใช้ชื่อใหม่ เช่น SPEC-${name}-v2`,
      );
      process.exit(1);
    }
    const chunks = buildChunks(roots, cwd);
    mkdirSync(specDirAbs, { recursive: true });
    writeFileSync(
      specPath,
      specTemplate(
        name,
        chunks,
        requested.length > 0
          ? roots.map((r) => relative(cwd, r) || ".").join(", ")
          : null,
      ),
    );
    specLink = `../${specDir(config).split("/").pop()}/SPEC-${name}.md`;
  }

  mkdirSync(planDirAbs, { recursive: true });
  writeFileSync(
    planPath,
    planTemplate(name, scope, risks, priorArt, contextFapony, specLink),
  );
  console.log(`wrote ${planPath}${specLink ? ` + SPEC-${name}.md` : ""}`);
}
