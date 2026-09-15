// src/map.ts — `fapony map`: an on-demand source index for TS/JS projects.
//
// One file, zero persistence: the tree and every export list are read from the
// filesystem and thrown away. No index file, no table, no MCP tool, no cache —
// standing cost to every other session is exactly zero (the opposite of a
// cached graph). Read-only: never writes into the mapped directory.
//
// `fapony map` is `fapony map .` — there is one code path, a per-dir listing.
// Drill by passing a child: map → map src → map src/stats → map <file>.
//
// Export names come from a line-based scan; Bun.Transpiler.scan() is the parse
// gate (throws => "parse error", never guessed away). scan() itself is not the
// export source: it returns names without lines and drops type-only exports
// (`export type`, `export interface`, `type X` inside braces) that a code map
// needs. See SPEC-code-map.md.
//
// A content-hash cache was prototyped and cut: hashing content requires reading
// every file, and reading already costs more than the parse the cache would
// save, so it bought no wall-clock win at L1 (measured 2026-09-15). It is
// deferred to L2 (crux excerpt), where per-file work is heavy enough to pay.

import type { Dirent } from "node:fs";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { basename, join, relative, resolve, sep } from "node:path";
import { collectSourceFiles, isSkippedDir, SCAN_EXTS } from "./analyze.js";

export type ExportKind =
  | "fn"
  | "class"
  | "const"
  | "type"
  | "interface"
  | "enum"
  | "namespace"
  | "default"
  | "re-export";

export interface ExportSymbol {
  name: string;
  /** 1-based line where the symbol is declared. */
  line: number;
  kind: ExportKind;
}

export interface ExportScan {
  symbols: ExportSymbol[];
  error: string | null;
}

const MAX_LINES = 60;
const MAX_EXPORTS = 6;
const OBJECTIVE_WIDTH = 72;
const CONTAINER_DIRS = 4;
const MAX_OBJECTIVE_FILES = 30;

// --- Parse gate ---

let transpiler: Bun.Transpiler | null = null;

interface ScanResult {
  error: string | null;
  exports: string[];
}

function scanSource(source: string): ScanResult {
  try {
    if (!transpiler) transpiler = new Bun.Transpiler({ loader: "tsx" });
    const scanned = transpiler.scan(source) as { exports: string[] };
    return { error: null, exports: scanned.exports };
  } catch (e) {
    return {
      error: e instanceof Error ? e.message.split("\n")[0] : "Parse error",
      exports: [],
    };
  }
}

// Identifiers in one line of code, skipping strings, template spans, and
// comments. Same-line only — enough to find extra bindings on a declaration
// line without treating sample text as code.
function codeIdentifiers(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  const flush = () => {
    if (/^[A-Za-z_$][\w$]*$/.test(cur)) out.push(cur);
    cur = "";
  };
  let i = 0;
  while (i < line.length) {
    const c = line[i];
    const next = line[i + 1] ?? "";
    if (c === "/" && next === "/") break;
    if (c === "/" && next === "*") {
      const end = line.indexOf("*/", i + 2);
      i = end < 0 ? line.length : end + 2;
      continue;
    }
    if (c === "'" || c === '"' || c === "`") {
      const quote = c;
      i++;
      while (i < line.length && line[i] !== quote) {
        i += line[i] === "\\" ? 2 : 1;
      }
      i++;
      continue;
    }
    if (/[A-Za-z_$0-9]/.test(c)) {
      cur += c;
    } else {
      flush();
    }
    i++;
  }
  flush();
  return out;
}

// --- Export extraction (name + line + kind) ---

const RE = {
  fn: /^export\s+(?:async\s+)?function\s*\*?\s*([A-Za-z_$][\w$]*)/,
  cls: /^export\s+(?:abstract\s+)?class\s+([A-Za-z_$][\w$]*)/,
  iface: /^export\s+interface\s+([A-Za-z_$][\w$]*)/,
  typ: /^export\s+type\s+([A-Za-z_$][\w$]*)/,
  en: /^export\s+(?:const\s+)?enum\s+([A-Za-z_$][\w$]*)/,
  ns: /^export\s+namespace\s+([A-Za-z_$][\w$]*)/,
  starAs: /^export\s*\*\s*as\s+([A-Za-z_$][\w$]*)/,
  star: /^export\s*\*\s+from\b/,
  brace: /^export\s+(?:type\s+)?\{/,
};

// Names in one `export { ... }` fragment. Handles `a as b` (keep b),
// per-name `type X`, and a whole block that started as `export type { ... }`
// (blockType is set by the caller from the opening line and carried across
// fragments, so every name in a multi-line type block stays `type`).
function braceNames(
  frag: string,
  blockType = false,
): { name: string; kind: ExportKind }[] {
  let text = frag.replace(/[{};]/g, " ");
  text = text.replace(/\bfrom\b[\s\S]*$/, " ");
  text = text.replace(/^export\s+/, "");
  const blockIsType = blockType || /^type\b/.test(text.trim());
  text = text.replace(/^type\s+/, "");
  const out: { name: string; kind: ExportKind }[] = [];
  for (let part of text.split(",")) {
    part = part.trim();
    if (!part) continue;
    let kind: ExportKind = blockIsType ? "type" : "re-export";
    if (/^type\s+/.test(part)) {
      part = part.replace(/^type\s+/, "");
      kind = "type";
    }
    const as = part.split(/\s+as\s+/);
    const name = (as.length > 1 ? as[as.length - 1] : as[0]).trim();
    if (name === "export") continue;
    if (name !== "default" && !/^[A-Za-z_$][\w$]*$/.test(name)) continue;
    out.push({ name, kind });
  }
  return out;
}

const VAR_DECL_RE = /^export\s+(?:const|let|var)\b/;

export function extractExports(source: string): ExportScan {
  const scanned = scanSource(source);
  if (scanned.error) return { symbols: [], error: scanned.error };

  // Ambient declarations (`export declare ...`) are invisible to scan(), so
  // validate value names against the union of the real source and a
  // declare-stripped variant scanned on the same lines.
  const stripped = source.replace(
    /^([ \t]*)export\s+declare\s+/gm,
    "$1export ",
  );
  const strippedScan = scanSource(stripped);
  const valid = new Set([
    ...scanned.exports,
    ...(strippedScan.error ? [] : strippedScan.exports),
  ]);
  const seen = new Set<string>();
  // scan() is blind to namespaces (and to ambient `declare`), so those kinds
  // stay regex-authoritative; everything else must appear in the parsed export
  // set, which is what filters sample text out of comments and strings.
  const SCAN_BLIND: ExportKind[] = ["type", "interface", "namespace"];
  const keep = (name: string, kind: ExportKind, declared: boolean): boolean => {
    if (name === "*") return true;
    if (SCAN_BLIND.includes(kind)) return true;
    if (seen.has(name)) return false;
    if (!declared && !valid.has(name)) return false;
    seen.add(name);
    return true;
  };
  const push = (
    out: ExportSymbol[],
    name: string,
    line: number,
    kind: ExportKind,
    declared: boolean,
  ): void => {
    if (keep(name, kind, declared)) out.push({ name, line, kind });
  };

  const lines = source.split("\n");
  const out: ExportSymbol[] = [];

  for (let i = 0; i < lines.length; i++) {
    let t = lines[i].trim();
    if (!t.startsWith("export")) continue;
    const declared = /^export\s+declare\s+/.test(t);
    t = t.replace(/^export\s+declare\s+/, "export ");
    const line = i + 1;
    let m: RegExpMatchArray | null;

    if (RE.brace.test(t)) {
      const blockType = /^export\s+type\b/.test(t);
      const frags = [{ text: t, line }];
      let joined = t;
      let j = i;
      while (!joined.includes("}") && j + 1 < lines.length) {
        j++;
        frags.push({ text: lines[j].trim(), line: j + 1 });
        joined += ` ${lines[j].trim()}`;
      }
      for (const f of frags) {
        for (const s of braceNames(f.text, blockType)) {
          push(out, s.name, f.line, s.kind, declared);
        }
      }
      i = j;
      continue;
    }
    if (/^export\s+default\b/.test(t)) {
      push(out, "default", line, "default", declared);
      continue;
    }
    if ((m = t.match(RE.fn))) {
      push(out, m[1], line, "fn", declared);
      continue;
    }
    if ((m = t.match(RE.cls))) {
      push(out, m[1], line, "class", declared);
      continue;
    }
    if ((m = t.match(RE.iface))) {
      push(out, m[1], line, "interface", declared);
      continue;
    }
    if ((m = t.match(RE.en))) {
      push(out, m[1], line, "enum", declared);
      continue;
    }
    if ((m = t.match(RE.ns))) {
      push(out, m[1], line, "namespace", declared);
      continue;
    }
    if ((m = t.match(RE.starAs))) {
      push(out, m[1], line, "namespace", declared);
      continue;
    }
    if (RE.star.test(t)) {
      push(out, "*", line, "re-export", declared);
      continue;
    }
    if ((m = t.match(RE.typ))) {
      push(out, m[1], line, "type", declared);
      continue;
    }
    const varMatch = t.match(VAR_DECL_RE);
    if (varMatch) {
      // A `const`/`let`/`var` line can bind several names
      // (`a = 1, b = 2`, `{ a, b } = …`, `[x] = …`). The scan set says which
      // identifiers on this line are real exports; initializers and sample
      // text never are.
      for (const name of codeIdentifiers(t.slice(varMatch[0].length))) {
        if (valid.has(name)) push(out, name, line, "const", declared);
      }
    }
  }
  return { symbols: out, error: null };
}

function scanFile(absFile: string): ExportScan {
  let source: string;
  try {
    source = readFileSync(absFile, "utf-8");
  } catch {
    return { symbols: [], error: "unreadable" };
  }
  return extractExports(source);
}

// --- Directory listing ---

interface Children {
  files: string[];
  dirs: string[];
}

function immediateChildren(absDir: string): Children {
  const files: string[] = [];
  const dirs: string[] = [];
  let entries: Dirent[];
  try {
    entries = readdirSync(absDir, { withFileTypes: true });
  } catch {
    return { files, dirs };
  }
  for (const e of entries) {
    if (e.isSymbolicLink()) continue;
    if (e.isDirectory()) {
      if (isSkippedDir(e.name) || e.name.startsWith(".")) continue;
      dirs.push(e.name);
    } else if (e.isFile()) {
      const dot = e.name.lastIndexOf(".");
      if (dot >= 0 && SCAN_EXTS.has(e.name.slice(dot))) files.push(e.name);
    }
  }
  files.sort();
  dirs.sort();
  return { files, dirs };
}

function countSourceFiles(absDir: string): number {
  try {
    return collectSourceFiles(absDir, { skipHidden: true }).length;
  } catch {
    return 0;
  }
}

// First comment content in the first ~12 lines + the line it sits on. Used only
// to guess a leaf dir's objective — a module header, not a doc parser.
function firstComment(source: string): { text: string; line: number } | null {
  const lines = source.split("\n").slice(0, 12);
  for (let i = 0; i < lines.length; i++) {
    const t = lines[i].trim();
    if (t === "") continue;
    if (t.startsWith("//")) {
      const text = t.replace(/^\/\/\s*/, "").trim();
      if (text && !text.startsWith("!")) return { text, line: i + 1 };
      continue;
    }
    if (t.startsWith("/*")) {
      const text = t
        .replace(/^\/\*+\s*/, "")
        .replace(/\*\/\s*$/, "")
        .trim();
      if (text) return { text, line: i + 1 };
      continue;
    }
    if (t.startsWith("*")) {
      const text = t
        .replace(/^\*+\s*/, "")
        .replace(/\*\/\s*$/, "")
        .trim();
      if (text) return { text, line: i + 1 };
      continue;
    }
    // Code before any comment: no module header here.
    return null;
  }
  return null;
}

function stripFilePrefix(text: string): string {
  const m = text.match(
    /^(?:[\w./-]*\/)?[\w.-]+\.(?:ts|tsx|js|jsx)\s*[—–-]\s*(.+)$/,
  );
  return (m ? m[1] : text).trim();
}

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

// Objective guess for a dir with no subdirs: the module header of the most
// descriptive file. Prefers `// path — desc` (the repo's convention), then a
// first-line comment, then any comment; ties break to the lexical-first file.
// Capped: a guess reads at most MAX_OBJECTIVE_FILES files, never a whole tree.
function guessObjective(absDir: string): string | null {
  let best: { text: string; score: number } | null = null;
  const files = collectSourceFiles(absDir, { skipHidden: true });
  for (const rel of files.slice(0, MAX_OBJECTIVE_FILES)) {
    let source: string;
    try {
      source = readFileSync(join(absDir, rel), "utf-8");
    } catch {
      continue;
    }
    const c = firstComment(source);
    if (!c) continue;
    const named = /^(?:[\w./-]*\/)?[\w.-]+\.(?:ts|tsx|js|jsx)\s*[—–-]\s*/.test(
      c.text,
    );
    const score = named && c.line === 1 ? 3 : named ? 2 : c.line === 1 ? 1 : 0;
    if (score > 0 && (!best || score > best.score)) {
      best = { text: stripFilePrefix(c.text), score };
    }
  }
  return best ? truncate(best.text, OBJECTIVE_WIDTH) : null;
}

function dirObjective(absDir: string): string | null {
  const { dirs } = immediateChildren(absDir);
  if (dirs.length >= CONTAINER_DIRS) {
    const shown = dirs.slice(0, 8).join(", ");
    const rest = dirs.length > 8 ? ` … (+${dirs.length - 8})` : "";
    return `dirs: ${shown}${rest}`;
  }
  return guessObjective(absDir);
}

function formatExports(symbols: ExportSymbol[]): string {
  if (symbols.length === 0) return "(no exports)";
  const shown = symbols.slice(0, MAX_EXPORTS);
  const tokens = shown.map((s) => `${s.name}:${s.line}`).join(" ");
  const rest =
    symbols.length > MAX_EXPORTS ? ` +${symbols.length - MAX_EXPORTS}` : "";
  return `${symbols.length} export${symbols.length === 1 ? "" : "s"}  ${tokens}${rest}`;
}

export function formatMapDir(absDir: string, rel: string): string {
  const isRoot = rel === ".";
  const total = countSourceFiles(absDir);
  const title = isRoot
    ? `fapony map — ${basename(absDir)} (${total} source files)`
    : `fapony map ${rel} — ${total} source files`;

  const { files, dirs } = immediateChildren(absDir);
  const rows: { name: string; desc: string }[] = [];

  for (const name of dirs) {
    const childAbs = join(absDir, name);
    const count = countSourceFiles(childAbs);
    if (count === 0) continue;
    const obj = dirObjective(childAbs);
    rows.push({
      name: `${name}/`,
      desc: `${count} file${count === 1 ? "" : "s"}${obj ? `  ${obj}` : ""}`,
    });
  }
  for (const name of files) {
    const scan = scanFile(join(absDir, name));
    rows.push({
      name,
      desc:
        scan.error === "unreadable"
          ? "unreadable"
          : scan.error
            ? `⚠ ${scan.error}`
            : formatExports(scan.symbols),
    });
  }

  rows.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));

  if (rows.length === 0) {
    return `${title}\n\n(no source files)`;
  }

  const width = Math.max(...rows.map((r) => r.name.length));
  const lines = [title, ""];
  // The overflow marker is a line of its own, so it counts against the cap:
  // 2 header lines + 57 rows + marker = 60, never 61.
  const room = MAX_LINES - 3;
  for (const r of rows.slice(0, room)) {
    lines.push(`  ${r.name.padEnd(width)}  ${r.desc}`);
  }
  if (rows.length > room) {
    lines.push(`  … +${rows.length - room} more`);
  }
  return lines.join("\n");
}

export function formatMapFile(absFile: string, rel: string): string {
  const scan = scanFile(absFile);
  if (scan.error && scan.error !== "unreadable") {
    return `fapony map ${rel} — parse error\n\n  ⚠ ${scan.error} — symbols not extractable`;
  }
  if (scan.error === "unreadable") {
    return `fapony map ${rel} — unreadable (cannot read file)`;
  }
  const { symbols } = scan;
  const head = `fapony map ${rel} — ${symbols.length} export${symbols.length === 1 ? "" : "s"}`;
  if (symbols.length === 0) return `${head}\n\n  (no exports)`;

  // Read source lines once for declaration signatures
  let srcLines: string[] = [];
  try {
    srcLines = readFileSync(absFile, "utf-8").split("\n");
  } catch {
    // unreadable already handled above; fall back to name-only
  }

  const lines = [head, ""];
  const room = MAX_LINES - 3;
  const shown = symbols.slice(0, room);
  const w = Math.max(...shown.map((s) => String(s.line).length));
  const SIG_MAX = 90;
  for (const s of shown) {
    const raw = srcLines[s.line - 1]?.trim() ?? "";
    const sig = raw.length > SIG_MAX ? `${raw.slice(0, SIG_MAX - 1)}…` : raw;
    lines.push(
      `  ${String(s.line).padStart(w)}  ${s.kind.padEnd(9)}  ${sig || s.name}`,
    );
  }
  if (symbols.length > shown.length) {
    lines.push(`  … +${symbols.length - shown.length} more`);
  }
  return lines.join("\n");
}

export function cmdMap(args: string[]): void {
  const target = args[0] ?? ".";
  const abs = resolve(target);
  let isFile: boolean;
  try {
    isFile = statSync(abs).isFile();
  } catch {
    console.error(`fapony map: "${target}" does not exist`);
    process.exit(1);
  }
  const rel = relative(process.cwd(), abs).split(sep).join("/") || ".";
  console.log(isFile ? formatMapFile(abs, rel) : formatMapDir(abs, rel));
}
