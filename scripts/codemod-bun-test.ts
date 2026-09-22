// scripts/codemod-bun-test.ts — one-shot: export function testX(): void {...}
// → test("testX", () => {...}); using bun:test. Run per file, review the diff,
// commit. Not meant to survive past PLAN-bun-test-migration (chunk 2-3).
//
// Usage: bun scripts/codemod-bun-test.ts [--write] <file...>
import { readFileSync, writeFileSync } from "node:fs";

const FN_HEAD =
  /export (async )?function (test\w+)\s*\([^)]*\)\s*:\s*(?:Promise<void>|void)\s*\{/g;

const REGEX_START_CHARS = new Set(
  "=>([,{!&|?:;{}~+-*%^",
);

function findMatchingBrace(src: string, start: number): number {
  let depth = 1;
  let i = start;
  while (depth > 0 && i < src.length) {
    const ch = src[i];
    if (ch === "{") {
      depth++;
    } else if (ch === "}") {
      depth--;
    } else if (ch === "'" || ch === '"') {
      const q = ch;
      i++;
      while (i < src.length && src[i] !== q) {
        if (src[i] === "\\") i++;
        i++;
      }
    } else if (ch === "`") {
      i++;
      while (i < src.length && src[i] !== "`") {
        if (src[i] === "\\") {
          i += 2;
          continue;
        }
        if (src[i] === "$" && src[i + 1] === "{") {
          i += 2;
          let exprDepth = 1;
          while (exprDepth > 0 && i < src.length) {
            if (src[i] === "{") exprDepth++;
            else if (src[i] === "}") exprDepth--;
            else if (src[i] === "'" || src[i] === '"') {
              const eq = src[i];
              i++;
              while (i < src.length && src[i] !== eq) {
                if (src[i] === "\\") i++;
                i++;
              }
            } else if (src[i] === "`") {
              i++;
              while (i < src.length && src[i] !== "`") {
                if (src[i] === "\\") i++;
                i++;
              }
            }
            i++;
          }
        } else {
          i++;
        }
      }
    } else if (ch === "/") {
      // Determine if this is a regex or division/comment
      if (src[i + 1] === "/") {
        // line comment
        while (i < src.length && src[i] !== "\n") i++;
      } else if (src[i + 1] === "*") {
        // block comment
        i += 2;
        while (i < src.length - 1 && !(src[i] === "*" && src[i + 1] === "/")) i++;
      } else {
        // Heuristic: / starts a regex if preceded by certain tokens
        let prevChar = " ";
        for (let j = i - 1; j >= 0; j--) {
          const p = src[j];
          if (p !== " " && p !== "\t" && p !== "\n" && p !== "\r") {
            prevChar = p;
            break;
          }
        }
        if (REGEX_START_CHARS.has(prevChar)) {
          // regex literal — skip to closing /
          i++;
          while (i < src.length && src[i] !== "/") {
            if (src[i] === "\\") i++;
            i++;
          }
        }
        // else: division operator, just continue
      }
    }
    i++;
  }
  return i;
}

function convert(src: string): { out: string; count: number } {
  let out = "";
  let cursor = 0;
  let count = 0;
  FN_HEAD.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = FN_HEAD.exec(src))) {
    const isAsync = Boolean(m[1]);
    const name = m[2];
    out += src.slice(cursor, m.index);
    out += `test("${name}", ${isAsync ? "async " : ""}() => {`;
    const bodyStart = m.index + m[0].length;
    const funcEnd = findMatchingBrace(src, bodyStart);
    out += src.slice(bodyStart, funcEnd - 1);
    out += "});";
    cursor = funcEnd;
    count++;
  }
  out += src.slice(cursor);
  if (count > 0 && !out.includes('from "bun:test"')) {
    out = `import { test } from "bun:test";\n${out}`;
  }
  return { out, count };
}

const args = process.argv.slice(2);
const write = args.includes("--write");
const files = args.filter((a) => a !== "--write");

for (const file of files) {
  const src = readFileSync(file, "utf8");
  const { out, count } = convert(src);
  console.log(`${file}: ${count} function(s) converted`);
  if (write) writeFileSync(file, out);
}
