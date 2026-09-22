// src/map.ts — extractExports(): an on-demand source index for TS/JS projects.
//
// Library only. The `fapony map` command this grew out of was deleted once
// plan-seed and review-seed were its only callers — see PLAN-code-map.
//
// Zero persistence: every export list is read from the filesystem and thrown
// away. No index file, no table, no MCP tool, no cache — standing cost to every
// other session is exactly zero (the opposite of a cached graph). Read-only.
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

// --- Parse gate (injectable: default is Bun.Transpiler, no Node fallback —
// Bun-only is a repo constraint. Pass a custom scanner to extractExports()
// to reuse this module outside Bun or in tests.) ---

export interface ExportScanner {
  scan(source: string): { exports: string[] };
}

function createBunScanner(): ExportScanner {
  const transpiler = new Bun.Transpiler({ loader: "tsx" });
  return {
    scan: (source) => transpiler.scan(source) as { exports: string[] },
  };
}

let defaultScanner: ExportScanner | null = null;

function getDefaultScanner(): ExportScanner {
  if (!defaultScanner) defaultScanner = createBunScanner();
  return defaultScanner;
}

interface ScanResult {
  error: string | null;
  exports: string[];
}

function scanSource(source: string, scanner: ExportScanner): ScanResult {
  try {
    const scanned = scanner.scan(source);
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

export function extractExports(
  source: string,
  scanner?: ExportScanner,
): ExportScan {
  const s = scanner ?? getDefaultScanner();
  const scanned = scanSource(source, s);
  if (scanned.error) return { symbols: [], error: scanned.error };

  // Ambient declarations (`export declare ...`) are invisible to scan(), so
  // validate value names against the union of the real source and a
  // declare-stripped variant scanned on the same lines.
  const stripped = source.replace(
    /^([ \t]*)export\s+declare\s+/gm,
    "$1export ",
  );
  const strippedScan = scanSource(stripped, s);
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

// First comment content in the first ~12 lines + the line it sits on. Used only
// to guess a leaf dir's objective — a module header, not a doc parser.

// Objective guess for a dir with no subdirs: the module header of the most
// descriptive file. Prefers `// path — desc` (the repo's convention), then a
// first-line comment, then any comment; ties break to the lexical-first file.
// Capped: a guess reads at most MAX_OBJECTIVE_FILES files, never a whole tree.

// --- Declaration slice (indent-out, no parser) ---

// Slice from the declaration line until the first line at the declaration's
// own indent level that is non-blank (indent-out). Raw indentation as the
// close signal means no brace counting and no parse — a one-liner returns
// itself, nested blocks and object literals never return to the base indent
// until the declaration is over. The closing line is the exception indent-out
// cannot see: `}` sits AT the declaration indent, so the walk stops one line
// short of it. Take that line when it is nothing but closers — which is why
// the slice a caller pastes into an edit is syntactically whole.
// Callers: review-seed --body, conventions seeder (wrapper detection).
const MAX_BODY_LINES = 80;

export function extractBody(source: string, line: number): string[] {
  const lines = source.split("\n");
  const start = line - 1;
  if (start < 0 || start >= lines.length) return [];
  const decl = lines[start];
  if (decl.trim() === "") return [];
  const base = decl.match(/^\s*/)?.[0].length ?? 0;
  const out: string[] = [decl];
  for (
    let i = start + 1;
    i < lines.length && out.length < MAX_BODY_LINES;
    i++
  ) {
    const l = lines[i];
    if (l.trim() === "") {
      out.push(l);
      continue;
    }
    if ((l.match(/^\s*/)?.[0].length ?? 0) <= base) {
      // Closers only (`}`, `};`, `});`) — never the next declaration.
      if (/^[)\]}]+[;,]?$/.test(l.trim())) out.push(l);
      break;
    }
    out.push(l);
  }
  // Trailing blank lines inside the slice are padding, not body.
  while (out.length > 1 && out[out.length - 1].trim() === "") out.pop();
  return out;
}
