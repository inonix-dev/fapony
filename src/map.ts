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

// First comment content in the first ~12 lines + the line it sits on. Used only
// to guess a leaf dir's objective — a module header, not a doc parser.

// Objective guess for a dir with no subdirs: the module header of the most
// descriptive file. Prefers `// path — desc` (the repo's convention), then a
// first-line comment, then any comment; ties break to the lexical-first file.
// Capped: a guess reads at most MAX_OBJECTIVE_FILES files, never a whole tree.
