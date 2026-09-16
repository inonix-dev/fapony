// src/plan-seed.ts — `fapony plan-seed <name> [--spec]`
//
// Writes PLAN (barrel) + SPEC (chunked) straight into planDir/specDir, with the
// factual sections pre-filled from map/analyze/mem/ledger. The agent is left
// with the judgment sections only. init-family: writes only the files the user
// asked for, inside planDir/specDir — never runtime state (that stays in
// ~/.config/fapony/). Deterministic: same input, same output, no LLM call.
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
import { join, resolve } from "node:path";
import {
  buildGraph,
  collectSourceFiles,
  diagnose,
  type Finding,
  isSkippedDir,
  SCAN_EXTS,
} from "./analyze.js";
import { computeModelFit } from "./context/projectHealth.js";
import { planDir, specDir } from "./db/getters.js";
import { loadConfig } from "./db/load.js";
import { extractExports } from "./map.js";
import { readRecentMemDecisions } from "./memory.js";
import { getStatsData } from "./stats/data.js";

// Scope stays a barrel: names + counts, not signatures (iron plan/spec split —
// signatures are born in the SPEC chunks only).
const MAX_SCOPE_EXPORTS = 5;
// The plan is a starting position, not a contract — cap §5 at the worst findings.
const MAX_RISKS = 5;
const SIG_MAX = 90;
// Anchor-safe slug: lowercase, non-alphanumerics → dash.
const slug = (s: string): string =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");

// --- Structural facts (§2 Scope) ---

interface ScopeRow {
  name: string;
  exportCount: number;
  exports: string[];
  error: string | null;
}

function scopeRows(absDir: string): ScopeRow[] {
  let entries: string[];
  try {
    entries = readdirSync(absDir, { withFileTypes: true })
      .filter(
        (e) =>
          !e.isSymbolicLink() &&
          !e.name.startsWith(".") &&
          !isSkippedDir(e.name),
      )
      .map((e) => e.name);
  } catch {
    return [];
  }
  const rows: ScopeRow[] = [];
  for (const name of entries.sort()) {
    const child = join(absDir, name);
    let st: import("node:fs").Stats;
    try {
      st = statSync(child);
    } catch {
      continue;
    }
    if (st.isDirectory()) {
      // A dir row stays a pointer (name + size) — drill happens in SPEC chunks.
      let count = 0;
      try {
        count = collectSourceFiles(child, { skipHidden: true }).length;
      } catch {
        count = 0;
      }
      rows.push({
        name: `${name}/`,
        exportCount: count,
        exports: [],
        error: count === 0 ? "empty" : null,
      });
    } else if (SCAN_EXTS.has(name.slice(name.lastIndexOf(".")))) {
      let source: string;
      try {
        source = readFileSync(child, "utf-8");
      } catch {
        rows.push({ name, exportCount: 0, exports: [], error: "unreadable" });
        continue;
      }
      const scan = extractExports(source);
      rows.push({
        name,
        exportCount: scan.symbols.length,
        exports: scan.symbols.map((s) => s.name).slice(0, MAX_SCOPE_EXPORTS),
        error: scan.error,
      });
    }
  }
  return rows;
}

function renderScope(absDir: string): string {
  const rows = scopeRows(absDir);
  const lines: string[] = [];
  for (const r of rows) {
    if (r.error === "unreadable") {
      lines.push(`- ${r.name} — ⚠ ${r.error} \`(fapony map)\``);
    } else if (r.name.endsWith("/")) {
      lines.push(`- ${r.name} — ${r.exportCount} file(s) \`(fapony map)\``);
    } else {
      const exports =
        r.exportCount === 0
          ? "no exports"
          : r.exportCount > r.exports.length
            ? `${r.exports.join(", ")}, +${r.exportCount - r.exports.length}`
            : r.exports.join(", ");
      lines.push(
        `- ${r.name} — ${r.exportCount} export(s): ${exports} \`(fapony map)\``,
      );
    }
  }
  return lines.length > 0 ? lines.join("\n") : "_(no source files found)_";
}

// --- Risks (§5) from analyze findings ---

function renderRisks(absDir: string): string {
  let findings: Finding[];
  try {
    findings = diagnose(buildGraph(absDir));
  } catch {
    return "_(analyze failed to scan this tree — run `fapony analyze` manually)_";
  }
  const structural = findings.filter((f) => f.kind !== "changed-untested");
  if (structural.length === 0) return "no findings — โครงสร้างไม่มีอะไรน่าห่วง";
  const lines = structural.slice(0, MAX_RISKS).map((f) => {
    const icon = f.kind === "orphan" ? "·" : "⚠";
    return `- ${icon} **${f.kind}** ${f.file} — ${f.detail} \`(fapony analyze)\``;
  });
  if (structural.length > MAX_RISKS) {
    lines.push(
      `- … +${structural.length - MAX_RISKS} more (run \`fapony analyze\` for the full list)`,
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

## 2. Scope — what exists to touch
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
_(agent เติม)_

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
          !isSkippedDir(e.name),
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

function buildChunks(absDir: string): Chunk[] {
  const chunks: Chunk[] = [];
  let entries: string[] = [];
  try {
    entries = readdirSync(absDir, { withFileTypes: true })
      .filter(
        (e) =>
          !e.isSymbolicLink() &&
          !e.name.startsWith(".") &&
          !isSkippedDir(e.name),
      )
      .map((e) => e.name)
      .sort();
  } catch {
    return chunks;
  }
  // Root files first, then one chunk per top-level dir.
  const rootLines = moduleChunkFiles(absDir, entries);
  if (rootLines.length > 0) {
    chunks.push({
      slug: "root",
      title: "(root files)",
      body: rootLines.join("\n").trimEnd(),
    });
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
    if (c) chunks.push(c);
  }
  return chunks;
}

function specTemplate(name: string, chunks: Chunk[]): string {
  const index = chunks.map((c) => `- [${c.title}](#${c.slug})`).join("\n");
  const bodies = chunks
    .map((c) => `## <a id="${c.slug}"></a>${c.title}\n\n${c.body}`)
    .join("\n\n");
  return `# SPEC-${name} — (agent เติมชื่อเรื่อง)

> **Used by:** PLAN-${name} — signatures below come from \`fapony map <file>\` (live scan — re-seed after structural changes).

## Chunk index

${index || "_(no chunks — no source files found)_"}

${bodies}

## (agent เติม — wireframes / edge cases / API shapes ที่ plan อ้างถึง)
`;
}

// --- CLI entry ---

export function cmdPlanSeed(args: string[]): void {
  const name = args.find((a) => !a.startsWith("--"));
  if (!name) {
    console.error("usage: fapony plan-seed <name> [--spec]");
    process.exit(1);
  }
  const withSpec = args.includes("--spec");
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

  const planDirAbs = join(cwd, planDir(config));
  const planPath = join(planDirAbs, `PLAN-${name}.md`);
  if (existsSync(planPath)) {
    console.error(
      `${planPath} already exists — not overwriting. ใช้ชื่อใหม่ เช่น PLAN-${name}-v2`,
    );
    process.exit(1);
  }

  const absDir = resolve(cwd, ".");
  const scope = renderScope(absDir);
  const risks = renderRisks(absDir);
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
    const chunks = buildChunks(absDir);
    mkdirSync(specDirAbs, { recursive: true });
    writeFileSync(specPath, specTemplate(name, chunks));
    specLink = `../${specDir(config).split("/").pop()}/SPEC-${name}.md`;
  }

  mkdirSync(planDirAbs, { recursive: true });
  writeFileSync(
    planPath,
    planTemplate(name, scope, risks, contextFapony, specLink),
  );
  console.log(`wrote ${planPath}${specLink ? ` + SPEC-${name}.md` : ""}`);
}
