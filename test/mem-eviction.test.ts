import { test } from "bun:test";
// test/mem-eviction.test.ts — PLAN-mem-core chunk 5: rows whose files[] are
// all gone from disk are reported by `mem stale` (EVICTED), a missing path
// whose basename names exactly one file on disk is followed as a move
// (MOVED + read/edit hint on the new path), and an ambiguous basename
// (2 files share it) stays silent — never guessed at.

import assert from "node:assert";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { readContextData } from "../src/adapters/hooks/context-data.js";
import { cmdStale } from "../src/mem/commands/read.js";
import {
  evictedRows,
  evictionReport,
  movedTargets,
} from "../src/mem/selectors.js";
import { initStore } from "../src/mem/store.js";
import { captureLogs, withTempRepo } from "./helpers.js";

const note = (
  id: string,
  text: string,
  files?: string[],
): Record<string, unknown> => ({
  ts: "2026-09-19T00:00:00Z",
  agent: "t",
  kind: "note",
  id,
  text,
  ...(files ? { files } : {}),
});

const close = (ref: string): Record<string, unknown> => ({
  ts: "2026-09-20T00:00:00Z",
  agent: "t",
  kind: "close",
  ref,
  text: "fixed",
});

function writeLog(dir: string, rows: Record<string, unknown>[]): void {
  mkdirSync(join(dir, ".fapony/.memory"), { recursive: true });
  writeFileSync(
    join(dir, ".fapony/.memory/log.t.jsonl"),
    `${rows.map((r) => JSON.stringify(r)).join("\n")}\n`,
  );
}

test("testDeletedFileIsEvicted", () => {
  const all = [note("n1", "about gone", ["gone.ts"])] as never;
  const exists = (f: string) => f !== "gone.ts";
  assert.deepEqual(
    evictedRows(all, exists).map((r) => r.id),
    ["n1"],
  );
  assert.deepEqual(evictionReport(all, exists, ["a.ts"]), [
    'EVICTED [n1] note files gone: gone.ts — "about gone"',
  ]);
  console.log("  ✓ deleted file → EVICTED");
});

test("testMovedFolderIsFollowed", () => {
  const all = [note("n1", "about a", ["old/a.ts"])] as never;
  const exists = (f: string) => f !== "old/a.ts";
  assert.deepEqual(
    evictedRows(all, exists).map((r) => r.id),
    ["n1"],
  );
  assert.deepEqual(
    movedTargets(["old/a.ts"], ["new/a.ts", "b.ts"]),
    new Map([["old/a.ts", "new/a.ts"]]),
  );
  assert.deepEqual(evictionReport(all, exists, ["new/a.ts", "b.ts"]), [
    'MOVED [n1] note old/a.ts → new/a.ts — "about a"',
  ]);
  console.log("  ✓ moved folder, unique basename → MOVED");
});

test("testAmbiguousBasenameStaysSilent", () => {
  // two files share the basename → no move entry; the row stays EVICTED
  // (the follow stays silent, the report does not pretend a move happened)
  assert.deepEqual(movedTargets(["old/a.ts"], ["x/a.ts", "y/a.ts"]), new Map());
  const all = [note("n1", "about a", ["old/a.ts"])] as never;
  const exists = (_f: string) => false;
  assert.deepEqual(evictionReport(all, exists, ["x/a.ts", "y/a.ts"]), [
    'EVICTED [n1] note files gone: old/a.ts — "about a"',
  ]);
  console.log("  ✓ basename shared by 2 files → no move, stays EVICTED");
});

test("testEvictionSkipsLiveRows", () => {
  const all = [
    note("n1", "one foot in", ["gone.ts", "here.ts"]),
    note("n2", "fileless", undefined),
    note("n3", "closed but gone", ["gone.ts"]),
    close("n3"),
  ] as never;
  const exists = (f: string) => f === "here.ts";
  // partial overlap → reachable via find --files, silent; fileless → silent;
  // closed → tombstoned, silent
  assert.deepEqual(evictedRows(all, exists), []);
  assert.deepEqual(evictionReport(all, exists, ["here.ts"]), []);
  console.log("  ✓ partial/fileless/closed rows stay silent");
});

test("testCmdStaleReportsEviction", () => {
  withTempRepo((dir) => {
    writeLog(dir, [note("n1", "about gone", ["gone.ts"])]);
    writeFileSync(join(dir, "a.ts"), "export const a = 1;\n");
    initStore(dir);
    const out = captureLogs(() => cmdStale());
    assert.match(out, /EVICTED \[n1\] note files gone: gone\.ts/);
  });
  console.log("  ✓ mem stale prints the EVICTED line");
});

test("testReadHintFollowsMove", () => {
  withTempRepo((dir) => {
    writeLog(dir, [note("n1", "about a", ["old/a.ts"])]);
    mkdirSync(join(dir, "new"), { recursive: true });
    writeFileSync(join(dir, "new/a.ts"), "export const a = 1;\n");
    const ctx = readContextData(join(dir, "new/a.ts"), dir);
    assert.ok(ctx, "context must resolve");
    assert.deepEqual(ctx!.memIds, ["n1"]);
    assert.equal(ctx!.memLines.length, 1);
    assert.match(
      ctx!.memLines[0],
      /fapony mem: 2026-09-19 note — about a \(moved from old\/a\.ts\)/,
    );
  });
  console.log("  ✓ read hint shows the row on the new path with moved-from");
});

test("testReadHintIgnoresAmbiguousMove", () => {
  withTempRepo((dir) => {
    writeLog(dir, [note("n1", "about a", ["old/a.ts"])]);
    mkdirSync(join(dir, "x"), { recursive: true });
    mkdirSync(join(dir, "y"), { recursive: true });
    writeFileSync(join(dir, "x/a.ts"), "export const a = 1;\n");
    writeFileSync(join(dir, "y/a.ts"), "export const a = 2;\n");
    const ctx = readContextData(join(dir, "x/a.ts"), dir);
    assert.ok(ctx, "context must resolve");
    assert.ok(
      !ctx!.memIds.includes("n1"),
      "ambiguous move must not attach the row",
    );
  });
  console.log("  ✓ ambiguous basename → row stays off the new path");
});
