import { test } from "bun:test";
// test/map.test.ts — tests for extractExports() (src/map.ts)

import assert from "node:assert";
import {
  type ExportScanner,
  extractExports,
  extractPythonExports,
} from "../src/map.js";

test("testMapExtractExports", () => {
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
});

test("testMapExtractExportsParseError", () => {
  const { symbols, error } = extractExports("export const = ;");
  assert.ok(error, "broken source must surface an error");
  assert.equal(symbols.length, 0);
  console.log("  ✓ map reports parse error instead of guessing");
});

test("testMapExtractIgnoresSampleText", () => {
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
});

test("testMapExtractMultilineTypeBlock", () => {
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
});

test("testMapExtractVarDeclaratorLists", () => {
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
});

test("testMapExtractAcceptsInjectedScanner", () => {
  const fake: ExportScanner = {
    scan: () => ({ exports: ["injected"] }),
  };
  const { symbols, error } = extractExports("export const injected = 1;", fake);
  assert.equal(error, null);
  assert.deepEqual(symbols, [{ name: "injected", line: 1, kind: "const" }]);

  const throwing: ExportScanner = {
    scan: () => {
      throw new Error("boom\nsecond line");
    },
  };
  const failed = extractExports("export const a = 1;", throwing);
  assert.equal(failed.error, "boom");
  assert.equal(failed.symbols.length, 0);
  console.log("  ✓ map honors an injected scanner (incl. its parse error)");
});

test("testMapPythonExports", () => {
  const src = [
    '"""Module docs with', // 1
    "def fake(): ...", // 2 — sample text, not an export
    '"""', // 3
    "import os", // 4 — graph data, not an export
    "from .core import helper as h, other", // 5
    "from .multi import (", // 6
    "    a,", // 7
    "    b,", // 8
    ")", // 9
    "def real(): ...", // 10
    "async def bg(): ...", // 11
    "class Svc: ...", // 12
    "x = 1", // 13
    "y: int = 2", // 14
    "_priv = 3", // 15 — private without __all__
    "x == 1", // 16 — comparison, not an assignment
    "if True:", // 17
    "    indented = 4", // 18 — not top level
  ].join("\n");
  const { symbols, error } = extractPythonExports(src);
  assert.equal(error, null);
  const by = (n: string) => symbols.find((s) => s.name === n);

  assert.deepEqual(by("real"), { name: "real", line: 10, kind: "fn" });
  assert.deepEqual(by("bg"), { name: "bg", line: 11, kind: "fn" });
  assert.deepEqual(by("Svc"), { name: "Svc", line: 12, kind: "class" });
  assert.deepEqual(by("x"), { name: "x", line: 13, kind: "const" });
  assert.deepEqual(by("y"), { name: "y", line: 14, kind: "const" });
  assert.deepEqual(by("h"), { name: "h", line: 5, kind: "re-export" });
  assert.deepEqual(by("other"), { name: "other", line: 5, kind: "re-export" });
  assert.deepEqual(by("a"), { name: "a", line: 6, kind: "re-export" });
  assert.deepEqual(by("b"), { name: "b", line: 6, kind: "re-export" });
  assert.ok(!symbols.some((s) => s.name === "fake"), "docstring def kept out");
  assert.ok(!symbols.some((s) => s.name === "os"), "plain import kept out");
  assert.ok(!symbols.some((s) => s.name === "_priv"), "underscore kept out");
  assert.ok(!symbols.some((s) => s.name === "indented"), "indented kept out");
  console.log(
    "  ✓ map extracts python top-level def/class/assign + re-exports",
  );
});

test("testMapPythonAll", () => {
  const src = [
    "def real(): ...", // 1
    "def hidden(): ...", // 2
    "_priv = 3", // 3
    "__all__ = [", // 4
    '    "real",', // 5
    '    "h",', // 6
    "]", // 7
    "from .core import h", // 8
  ].join("\n");
  const { symbols, error } = extractPythonExports(src);
  assert.equal(error, null);
  // `__all__` is authoritative: hidden drops out, listed _-names stay in.
  assert.deepEqual(symbols, [
    { name: "real", line: 1, kind: "fn" },
    { name: "h", line: 8, kind: "re-export" },
  ]);
  console.log("  ✓ map treats __all__ as the authoritative export list");
});

test("testMapPythonDispatch", () => {
  const { symbols, error } = extractExports(
    "def f(): ...\nx = 1\n",
    undefined,
    "x.py",
  );
  assert.equal(error, null);
  assert.deepEqual(symbols, [
    { name: "f", line: 1, kind: "fn" },
    { name: "x", line: 2, kind: "const" },
  ]);
  // Same source without a filename stays on the TS path (a parse error here,
  // never python symbols leaking into it).
  const ts = extractExports("def f(): ...\nx = 1\n");
  assert.ok(!ts.symbols.some((s) => s.name === "f"));
  console.log("  ✓ map dispatches to the python path on .py filenames only");
});

test("testMapPythonTripleQuoteInsideString", () => {
  const src = [
    'x = \'contains """ here\'', // 1 — a string, not a block opener
    "from .core import helper", // 2
    "def real(): ...", // 3
  ].join("\n");
  const { symbols } = extractPythonExports(src);
  assert.ok(
    symbols.some((s) => s.name === "real"),
    "later def survives",
  );
  assert.ok(
    symbols.some((s) => s.name === "helper"),
    "later re-export survives",
  );
  console.log(
    "  ✓ map does not open a block on a triple quote inside a string",
  );
});
