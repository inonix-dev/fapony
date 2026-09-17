// test/map.test.ts — tests for `fapony map` (src/map.ts)

import assert from "node:assert";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  cmdMap,
  extractExports,
  formatMapDir,
  formatMapFile,
} from "../src/map.js";
import { captureErrors } from "./helpers.js";

function withFixture(
  files: Record<string, string>,
  fn: (dir: string) => void,
): void {
  const dir = mkdtempSync(join(tmpdir(), "fapony-map-"));
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

export function testMapExtractExports(): void {
  const src = [
    "export const a = 1;", // 1
    "export function b() {}", // 2
    "export async function c() {}", // 3
    "export class D {}", // 4
    "export abstract class E {}", // 5
    "export interface F {}", // 6
    "export type G = string;", // 7
    "export enum H {}", // 8
    "export const enum I {}", // 9
    "export namespace J {}", // 10
    "const k = 1;", // 11
    "export { k as alias };", // 12
    "export type { F as F2 };", // 13
    'export * as ns from "./x";', // 14
    'export * from "./y";', // 15
    "export default function z() {}", // 16
    "export declare const dd = 1;", // 17
    "export {", // 18
    "  one,", // 19
    "  type Two,", // 20
    '} from "./m";', // 21
  ].join("\n");
  const { symbols, error } = extractExports(src);
  assert.equal(error, null);
  const by = (n: string) => symbols.find((s) => s.name === n);

  assert.deepEqual(by("a"), { name: "a", line: 1, kind: "const" });
  assert.deepEqual(by("b"), { name: "b", line: 2, kind: "fn" });
  assert.deepEqual(by("c"), { name: "c", line: 3, kind: "fn" });
  assert.deepEqual(by("D"), { name: "D", line: 4, kind: "class" });
  assert.deepEqual(by("E"), { name: "E", line: 5, kind: "class" });
  assert.deepEqual(by("F"), { name: "F", line: 6, kind: "interface" });
  assert.deepEqual(by("G"), { name: "G", line: 7, kind: "type" });
  assert.deepEqual(by("H"), { name: "H", line: 8, kind: "enum" });
  assert.deepEqual(by("I"), { name: "I", line: 9, kind: "enum" });
  assert.deepEqual(by("J"), { name: "J", line: 10, kind: "namespace" });
  assert.deepEqual(by("alias"), { name: "alias", line: 12, kind: "re-export" });
  assert.deepEqual(by("F2"), { name: "F2", line: 13, kind: "type" });
  assert.deepEqual(by("ns"), { name: "ns", line: 14, kind: "namespace" });
  assert.deepEqual(by("*"), { name: "*", line: 15, kind: "re-export" });
  assert.deepEqual(by("default"), {
    name: "default",
    line: 16,
    kind: "default",
  });
  assert.deepEqual(by("dd"), { name: "dd", line: 17, kind: "const" });
  assert.deepEqual(by("one"), { name: "one", line: 19, kind: "re-export" });
  assert.deepEqual(by("Two"), { name: "Two", line: 20, kind: "type" });
  console.log("  ✓ map extracts export name + line + kind (incl. types)");
}

export function testMapExtractExportsParseError(): void {
  const { symbols, error } = extractExports("export const = ;");
  assert.ok(error, "broken source must surface an error");
  assert.equal(symbols.length, 0);
  console.log("  ✓ map reports parse error instead of guessing");
}

export function testMapExtractIgnoresSampleText(): void {
  const src = [
    "/*",
    "export const fake = 1;",
    "*/",
    "export const real = 2;",
    "const sample = `",
    "export const ghost = 9;",
    "`;",
    "export const live = 1;",
  ].join("\n");
  const { symbols, error } = extractExports(src);
  assert.equal(error, null);
  const names = symbols.map((s) => s.name).sort();
  assert.deepEqual(names, ["live", "real"]);
  assert.deepEqual(
    symbols.find((s) => s.name === "real"),
    { name: "real", line: 4, kind: "const" },
  );
  console.log("  ✓ map ignores exports inside comments and template text");
}

export function testMapExtractMultilineTypeBlock(): void {
  const src = [
    "export type {",
    "  Alpha,",
    "  Beta as Gamma,",
    '} from "./m";',
  ].join("\n");
  const { symbols, error } = extractExports(src);
  assert.equal(error, null);
  assert.deepEqual(symbols, [
    { name: "Alpha", line: 2, kind: "type" },
    { name: "Gamma", line: 3, kind: "type" },
  ]);
  console.log("  ✓ map keeps every name in a multi-line type block as type");
}

export function testMapExtractVarDeclaratorLists(): void {
  const src = [
    "export const one = 1, two = 2;",
    "export const { a, b } = point();",
    "export let m;",
  ].join("\n");
  const { symbols, error } = extractExports(src);
  assert.equal(error, null);
  const by = (n: string) => symbols.find((s) => s.name === n);
  assert.deepEqual(by("one"), { name: "one", line: 1, kind: "const" });
  assert.deepEqual(by("two"), { name: "two", line: 1, kind: "const" });
  assert.deepEqual(by("a"), { name: "a", line: 2, kind: "const" });
  assert.deepEqual(by("b"), { name: "b", line: 2, kind: "const" });
  assert.deepEqual(by("m"), { name: "m", line: 3, kind: "const" });
  assert.ok(!symbols.some((s) => s.name === "point"), "initializer kept out");
  console.log(
    "  ✓ map binds every name in a declarator list, not just the first",
  );
}

export function testMapDirListing(): void {
  withFixture(
    {
      "a.ts": "export const alpha = 1;\nexport function beta() {}\n",
      "b.ts": "// b.ts — helper\n",
      "notes.md": "# not source\n",
      "sub/c.ts": "export const gamma = 1;\n",
    },
    (dir) => {
      const out = formatMapDir(dir, ".");
      assert.match(out, /fapony map — .* \(3 source files\)/);
      assert.match(out, /a\.ts\s+2 exports\s+alpha:1 beta:2/);
      assert.match(out, /b\.ts\s+\(no exports\)/);
      assert.match(out, /sub\/\s+1 file/);
      assert.doesNotMatch(out, /notes\.md/, "non-source files are not listed");
      // deterministic: a second call yields byte-identical output
      assert.equal(formatMapDir(dir, "."), out);
      console.log("  ✓ map lists dir: files + exports, subdirs, no non-source");
    },
  );
}

export function testMapFileAndBroken(): void {
  withFixture(
    {
      "ok.ts": "export const x = 1;\n",
      "broken.ts": "export const = ;\n",
      "empty.ts": "const internal = 1;\n",
    },
    (dir) => {
      const ok = formatMapFile(join(dir, "ok.ts"), "ok.ts");
      assert.match(ok, /— 1 export/);
      assert.match(ok, /1\s+const\s+export const x = 1;/);

      const empty = formatMapFile(join(dir, "empty.ts"), "empty.ts");
      assert.match(empty, /\(no exports\)/);

      const dirOut = formatMapDir(dir, ".");
      assert.match(dirOut, /broken\.ts\s+⚠ Parse error/);
      console.log("  ✓ map file detail + broken file reported, not silent");
    },
  );
}

export function testMapFileShowsSignature(): void {
  withFixture(
    {
      "sig.ts": [
        "export function greet(name: string): string {",
        // Fixture source, not this file's code: the ${...} is TypeScript that
        // formatMapFile has to parse. Interpolating it here would substitute a
        // variable from this test and change what is being parsed.
        // biome-ignore lint/suspicious/noTemplateCurlyInString: fixture source
        "  return `Hello, ${name}!`;",
        "}",
        "export class Point {",
        "  constructor(public x: number, public y: number) {}",
        "}",
      ].join("\n"),
    },
    (dir) => {
      const out = formatMapFile(join(dir, "sig.ts"), "sig.ts");
      assert.match(
        out,
        /fn\s+export function greet\(name: string\): string \{/,
      );
      assert.match(out, /class\s+export class Point \{/);
      console.log("  ✓ map file shows declaration signature alongside export");
    },
  );
}

export function testMapDirCap(): void {
  const files: Record<string, string> = {};
  for (let i = 0; i < 61; i++) {
    files[`f${String(i).padStart(2, "0")}.ts`] = `export const x${i} = ${i};\n`;
  }
  withFixture(files, (dir) => {
    const out = formatMapDir(dir, ".");
    assert.ok(
      out.split("\n").length <= 60,
      `listing capped at 60 lines, got ${out.split("\n").length}`,
    );
    assert.match(out, /… \+\d+ more/);
    console.log("  ✓ map dir listing never exceeds the 60-line cap");
  });
}

export function testMapMissingPath(): void {
  let code: number | null = null;
  const origExit = process.exit;
  const errs = captureErrors(() => {
    process.exit = ((c?: number) => {
      code = c ?? 0;
      throw new Error("__exit__");
    }) as never;
    try {
      cmdMap(["definitely-not-a-real-path-xyz"]);
    } catch {
      // the exit stub throws to unwind
    } finally {
      process.exit = origExit;
    }
  });
  assert.equal(code, 1);
  assert.match(errs, /does not exist/);
  console.log("  ✓ map missing path: clear message, exit 1, no throw");
}
