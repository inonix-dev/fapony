// src/conventions-seed.ts — `fapony init` fill-signal (PLAN-convention-debt chunk 2).
//
// Question: "how far can signal-filling at init go" (SPEC-convention-debt §2.2) —
// Measured twice; the first answer was wrong: eslint is what most teams leave at default on install,
// pair-mining breaks on large commits and the cap cannot be relaxed (measured) — what **every repo has**
// is its own code, so the base is a wrapper detector (reads the snapshot only, never touches history),
// eslint is a bonus when present, pair-mining is not done yet (chunk 7 measures precision first)
//
// Written to one place: <target>/.fapony/conventions.json — the convention definition lives in the repo being
// measured (SPEC §2.1), committable because every field is repo-relative · already exists = leave untouched
// (rule 5c) · fapony does not guess a convention with no trace — one never migrated and
// with no wrapper has no trace in either snapshot or history, that slot is left for a human to fill (stale)

import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { pathToFileURL } from "node:url";
import { collectSourceFiles, isSkippedDir, isTestFile } from "./analyze.js";
import { CONVENTIONS_FILE, FAPONY_DIR } from "./core/config.js";
import { extractBody, extractExports } from "./map.js";

const RESTRICTED_RULES = new Set([
  "no-restricted-imports",
  "no-restricted-syntax",
  "no-restricted-properties",
]);
// Flat-config era + eslint.rules.js companions — where the measured entries live.
// Legacy .eslintrc (JSON/YAML) is not importable and is skipped on purpose.
const CONFIG_IMPORTABLE_RE = /^(eslint\.config|eslint\.rules)\.(js|mjs|cjs)$/;
const RESTRICTED_TEXT_RE = /no-restricted-(imports|syntax|properties)/;

export interface SeedResult {
  file: string;
  /** Conventions derived from eslint no-restricted-* entries (they carry checker). */
  eslintRows: number;
  /** Wrapper-derived candidates (checker null — no checker exists yet). */
  wrapperRows: number;
  configs: string[];
  /** Config found but not importable (missing deps of that repo) — said, never silent. */
  skipped: string[];
  /** conventions.json already existed — left untouched (rule 5c). */
  kept?: boolean;
}

export interface SeedRow {
  id: string;
  rule: string;
  where: string;
  stale: string | null;
  ok?: string;
  guard?: string;
  checker: string | null;
  decided?: null;
}

function slug(s: string): string {
  return (
    s
      .replace(/[^A-Za-z0-9._-]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .toLowerCase() || "x"
  );
}

function flatText(s: unknown): string | null {
  if (typeof s !== "string") return null;
  const t = s.replace(/\s+/g, " ").trim();
  return t.length > 0 ? t : null;
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// "src/**/*.{ts,tsx}" → "src" · "**\/x" → "." · "src/routes/**/*.tsx" → "src/routes"
function globDir(glob: unknown): string | null {
  if (typeof glob !== "string" || glob.length === 0) return null;
  const cut = glob.replace(/[\\/]\*\*.*$/, "").replace(/\*\*.*$/, "");
  const dir = cut.replace(/\/+$/, "");
  return dir === "" ? "." : dir;
}

// --- eslint config extraction ---

interface Block {
  files?: unknown;
  rules?: Record<string, unknown>;
}

function* walkBlocks(node: unknown, depth = 0): Generator<Block> {
  if (depth > 6 || !node || typeof node !== "object") return;
  if (Array.isArray(node)) {
    for (const n of node) yield* walkBlocks(n, depth + 1);
    return;
  }
  const o = node as Record<string, unknown>;
  if (o.rules && typeof o.rules === "object") yield o as Block;
  for (const v of Object.values(o)) {
    if (Array.isArray(v) || (v && typeof v === "object")) {
      yield* walkBlocks(v, depth + 1);
    }
  }
}

function rowsFromBlock(block: Block, whereBase: string): SeedRow[] {
  const out: SeedRow[] = [];
  const whereGlob = Array.isArray(block.files) ? globDir(block.files[0]) : null;
  const dir = whereBase === "." ? "" : `${whereBase}/`;
  const where =
    whereGlob && whereGlob !== "." ? `${dir}${whereGlob}` : whereBase || ".";
  const push = (message: unknown, stale: string | null, ruleId: string) => {
    const text = flatText(message);
    if (!text) return; // a checker without a message = the rule is unknown
    out.push({ id: "", rule: text, where, stale, checker: ruleId });
  };
  for (const [ruleId, value] of Object.entries(block.rules ?? {})) {
    if (!RESTRICTED_RULES.has(ruleId) || !Array.isArray(value)) continue;
    const [, ...entries] = value;
    if (ruleId === "no-restricted-imports") {
      // ["error", { paths: [{name, message, importNames?}], patterns: [{group, message}] }]
      for (const opt of entries) {
        if (!opt || typeof opt !== "object") continue;
        const o = opt as Record<string, unknown>;
        for (const p of Array.isArray(o.paths) ? o.paths : []) {
          const e = p as Record<string, unknown>;
          if (!e || typeof e !== "object") continue;
          const name = typeof e.name === "string" ? e.name : null;
          const stale =
            name && !Array.isArray(e.importNames)
              ? `["']${escapeRe(name)}["']`
              : null; // named-import bans are not one text pattern
          push(e.message, stale, ruleId);
        }
        for (const p of Array.isArray(o.patterns) ? o.patterns : []) {
          const e = p as Record<string, unknown>;
          if (!e || typeof e !== "object") continue;
          push(e.message, null, ruleId); // gitignore-style group — no text regex
        }
      }
      continue;
    }
    // no-restricted-syntax / -properties: ["error", entry, entry, ...]
    for (const e of entries) {
      if (!e || typeof e !== "object") continue;
      const o = e as Record<string, unknown>;
      let stale: string | null = null;
      if (ruleId === "no-restricted-properties") {
        const prop = typeof o.property === "string" ? o.property : null;
        if (prop) {
          stale =
            typeof o.object === "string"
              ? `${escapeRe(o.object)}\\.${escapeRe(prop)}\\(`
              : `\\.${escapeRe(prop)}\\(`;
        }
      }
      // no-restricted-syntax: the selector is AST-shaped — no honest text
      // regex. The row still lands (checker set → the debt detector stays
      // silent anyway; the row's value is the rule text in one place).
      push(o.message, stale, ruleId);
    }
  }
  return out;
}

function findConfigFiles(root: string): string[] {
  const out: string[] = [];
  const stack = [root];
  while (stack.length > 0) {
    const dir = stack.pop() as string;
    let entries: import("node:fs").Dirent[];
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      if (e.isSymbolicLink()) continue;
      if (e.isDirectory()) {
        if (isSkippedDir(e.name, dir)) continue;
        stack.push(join(dir, e.name));
      } else if (e.isFile() && CONFIG_IMPORTABLE_RE.test(e.name)) {
        out.push(join(dir, e.name));
      }
    }
  }
  return out.sort();
}

async function eslintRows(
  root: string,
): Promise<{ rows: SeedRow[]; configs: string[]; skipped: string[] }> {
  const rows: SeedRow[] = [];
  const configs: string[] = [];
  const skipped: string[] = [];
  for (const abs of findConfigFiles(root)) {
    let raw: string;
    try {
      raw = readFileSync(abs, "utf-8");
    } catch {
      continue;
    }
    if (!RESTRICTED_TEXT_RE.test(raw)) continue;
    configs.push(relative(root, abs));
    let mod: Record<string, unknown>;
    try {
      // The config is code from the measured repo — same trust as running its
      // own eslint. Import (not text-parse) so shared constants and .map()
      // computed entries resolve to real values.
      mod = (await import(pathToFileURL(abs).href)) as Record<string, unknown>;
    } catch (e) {
      skipped.push(
        `${relative(root, abs)} — import failed: ${
          e instanceof Error ? e.message.split("\n")[0] : "?"
        }`,
      );
      continue;
    }
    const cfgDir = dirname(relative(root, abs));
    for (const block of walkBlocks(mod.default ?? mod)) {
      rows.push(...rowsFromBlock(block, cfgDir === "." ? "." : cfgDir));
    }
  }
  // Dedupe identical (checker, message) pairs that flat-config supersets repeat,
  // then hand out unique ids.
  const byMessage = new Map<string, SeedRow>();
  for (const r of rows) {
    const key = `${r.checker}\n${r.rule}`;
    if (!byMessage.has(key)) byMessage.set(key, r);
  }
  const usedId = new Set<string>();
  const final: SeedRow[] = [];
  for (const r of byMessage.values()) {
    let id = `eslint-${slug(r.rule).slice(0, 40)}`;
    for (let n = 2; usedId.has(id); n++)
      id = `eslint-${slug(r.rule).slice(0, 40)}-${n}`;
    usedId.add(id);
    final.push({ ...r, id });
  }
  return { rows: final, configs, skipped };
}

// --- wrapper detector (snapshot only — no history, no eslint) ---

const KEYWORDS = new Set([
  "if",
  "for",
  "while",
  "switch",
  "catch",
  "function",
  "return",
  "new",
  "typeof",
  "delete",
  "void",
  "in",
  "of",
  "do",
  "else",
  "super",
  "import",
  "await",
  "async",
  "yield",
  "case",
  "throw",
]);
const MAX_WRAPPER_CANDIDATES = 40;
const MIN_USERS = 3;
const MIN_DIRECT = 2;
const MAX_DIRECT = 100;

interface Candidate {
  wrapper: string;
  file: string;
  callText: string; // regex source, e.g. \.toLocaleString\( or newId\(
  display: string; // e.g. .toLocaleString( / newId(
}

function callsInBody(body: string, local: Set<string>): Set<string> {
  const found = new Set<string>();
  for (const m of body.matchAll(/(?<![.\w$])([A-Za-z_$][\w$]*)\s*\(/g)) {
    const name = m[1];
    if (!KEYWORDS.has(name) && !local.has(name)) found.add(name);
  }
  for (const m of body.matchAll(/\.([A-Za-z_$][\w$]*)\s*\(/g)) {
    found.add(`.${m[1]}`);
  }
  return found;
}

function detectWrappers(root: string): SeedRow[] {
  const files = collectSourceFiles(root);
  const candidates: Candidate[] = [];
  for (const rel of files) {
    if (candidates.length >= MAX_WRAPPER_CANDIDATES) break;
    if (isTestFile(rel)) continue; // test fixtures are not convention sources
    let source: string;
    try {
      source = readFileSync(join(root, rel), "utf-8");
    } catch {
      continue;
    }
    const scan = extractExports(source, undefined, rel);
    if (scan.error) continue;
    for (const sym of scan.symbols) {
      if (sym.kind !== "const" && sym.kind !== "fn") continue;
      const body = extractBody(source, sym.line).join("\n");
      if (body.length < 10 || body.length > 2000) continue;
      const local = new Set(scan.symbols.map((s) => s.name));
      for (const call of callsInBody(body, local)) {
        const ident = call.startsWith(".") ? call.slice(1) : call;
        if (ident === sym.name) continue;
        candidates.push({
          wrapper: sym.name,
          file: rel,
          callText: call.startsWith(".")
            ? `\\.${escapeRe(ident)}\\(`
            : `\\b${escapeRe(ident)}\\(`,
          display: call.startsWith(".") ? `.${ident}(` : `${ident}(`,
        });
        if (candidates.length >= MAX_WRAPPER_CANDIDATES) break;
      }
      if (candidates.length >= MAX_WRAPPER_CANDIDATES) break;
    }
  }
  if (candidates.length === 0) return [];

  // One pass over the tree counting, per candidate: files still calling the
  // wrapped thing directly (never referencing the wrapper) vs files using the
  // wrapper. Both directions must be real for this to be a live migration.
  const direct = new Map<Candidate, number>();
  const users = new Map<Candidate, number>();
  const wrapperRe = new Map<Candidate, RegExp>();
  for (const c of candidates) {
    wrapperRe.set(c, new RegExp(`\\b${escapeRe(c.wrapper)}\\b`));
    direct.set(c, 0);
    users.set(c, 0);
  }
  for (const rel of files) {
    let content: string;
    try {
      content = readFileSync(join(root, rel), "utf-8");
    } catch {
      continue;
    }
    for (const c of candidates) {
      if (rel === c.file) continue;
      const uses = wrapperRe.get(c)!.test(content);
      if (uses) users.set(c, users.get(c)! + 1);
      if (!uses && new RegExp(c.callText).test(content)) {
        direct.set(c, direct.get(c)! + 1);
      }
    }
  }

  const out: SeedRow[] = [];
  const seenId = new Set<string>();
  for (const c of candidates) {
    const d = direct.get(c) ?? 0;
    const u = users.get(c) ?? 0;
    if (d < MIN_DIRECT || d > MAX_DIRECT || u < MIN_USERS) continue;
    const id = `wrap-${slug(c.wrapper)}`;
    if (seenId.has(id)) continue;
    seenId.add(id);
    out.push({
      id,
      rule: `use ${c.wrapper}() instead of ${c.display} directly (${d} file(s) still call it raw, ${u} file(s) already use the wrapper)`,
      where: ".",
      stale: c.callText,
      ok: `\\b${escapeRe(c.wrapper)}\\b`,
      checker: null,
    });
  }
  return out;
}

// --- entry ---

export async function seedConventionsFile(target: string): Promise<SeedResult> {
  const file = join(target, CONVENTIONS_FILE);
  const base: SeedResult = {
    file,
    eslintRows: 0,
    wrapperRows: 0,
    configs: [],
    skipped: [],
  };
  try {
    JSON.parse(readFileSync(file, "utf-8"));
    return { ...base, kept: true }; // exists → never overwrite (rule 5c)
  } catch {
    // no file yet — proceed
  }
  const rows: SeedRow[] = [];
  let configs: string[] = [];
  const skipped: string[] = [];
  try {
    const es = await eslintRows(target);
    rows.push(...es.rows);
    configs = es.configs;
    skipped.push(...es.skipped);
  } catch {
    // eslint extraction must never fail the scaffold
  }
  try {
    rows.push(...detectWrappers(target));
  } catch {
    // a wrapper scan failure is not an init failure
  }
  const payload = `${JSON.stringify({ conventions: rows }, null, 2)}\n`;
  mkdirSync(join(target, FAPONY_DIR), { recursive: true });
  writeFileSync(file, payload);
  return {
    file,
    eslintRows: rows.filter((r) => r.checker !== null).length,
    wrapperRows: rows.filter((r) => r.checker === null).length,
    configs,
    skipped,
  };
}
