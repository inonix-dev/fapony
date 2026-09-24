import { test } from "bun:test";
import assert from "node:assert";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { readContextData } from "../../src/adapters/hooks/context-data.js";
import { clipMemText, MEM_TEXT_MAX } from "../../src/core/mem-log.js";
import { withStateDir, withTempRepo } from "./helpers.js";

// The mem footer on read/edit hints: newest rows first, clipped at a word
// boundary, and each row shown once per session — it used to repeat the same
// two oldest rows, cut mid-word, on every edit.

const note = (id: string, ts: string, text: string, files: string[]) => ({
  ts,
  agent: "t",
  kind: "note",
  id,
  text,
  files,
});

function writeLog(dir: string, rows: Record<string, unknown>[]): void {
  mkdirSync(join(dir, ".fapony/.memory"), { recursive: true });
  writeFileSync(
    join(dir, ".fapony/.memory/log.t.jsonl"),
    `${rows.map((r) => JSON.stringify(r)).join("\n")}\n`,
  );
}

test("testClipMemTextWordBoundary", () => {
  assert.equal(clipMemText("short"), "short");
  const long = `${"word ".repeat(40)}end`;
  const out = clipMemText(long);
  assert.ok(out.length <= MEM_TEXT_MAX, "stays within budget");
  assert.ok(out.endsWith("word…"), `cut lands on a whole word: ${out}`);
  const token = "x".repeat(200);
  assert.equal(
    clipMemText(token).length,
    MEM_TEXT_MAX,
    "one long token hard-cuts",
  );
});

test("testFooterNewestFirstAndExactBeforeMention", () => {
  withTempRepo((dir) => {
    writeLog(dir, [
      note("old", "2026-01-01T00:00:00Z", "old exact", ["a.ts"]),
      note("mid", "2026-02-01T00:00:00Z", "mentions a.ts only", ["b.ts"]),
      note("new", "2026-03-01T00:00:00Z", "new exact", ["a.ts"]),
    ]);
    writeFileSync(join(dir, "a.ts"), "export const a = 1;\n");
    const ctx = readContextData(join(dir, "a.ts"), dir);
    assert.deepEqual(ctx!.memIds, ["new", "old"]);
  });
});

test("testFooterShowsEachRowOncePerSession", () => {
  withStateDir(() => {
    withTempRepo((dir) => {
      writeLog(dir, [
        note("r1", "2026-01-01T00:00:00Z", "one", ["a.ts"]),
        note("r2", "2026-02-01T00:00:00Z", "two", ["a.ts"]),
        note("r3", "2026-03-01T00:00:00Z", "three", ["a.ts"]),
      ]);
      writeFileSync(join(dir, "a.ts"), "export const a = 1;\n");
      const f = join(dir, "a.ts");
      assert.deepEqual(readContextData(f, dir, "s1")!.memIds, ["r3", "r2"]);
      assert.deepEqual(readContextData(f, dir, "s1")!.memIds, ["r1"]);
      assert.deepEqual(readContextData(f, dir, "s1")!.memLines, []);
      // another session starts fresh; no session = no dedupe
      assert.deepEqual(readContextData(f, dir, "s2")!.memIds, ["r3", "r2"]);
      assert.deepEqual(readContextData(f, dir)!.memIds, ["r3", "r2"]);
    });
  });
});
