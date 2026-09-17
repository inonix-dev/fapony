// test/map.test.ts — tests for extractExports() (src/map.ts)

import assert from "node:assert";
import { extractExports } from "../src/map.js";

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
