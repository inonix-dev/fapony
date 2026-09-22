import { test } from "bun:test";

// test/session/shared.test.ts — cross-client utilities + edge cases

import { Database } from "bun:sqlite";
import assert from "node:assert";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beginSnapshot, endSnapshot } from "../../src/session/helpers.js";
import { mergeBytesByTool, readPassiveUsage } from "../../src/session/index.js";

test("testMergeBytesByToolSumsAcrossClients", () => {
  const a = {
    tool_breakdown: {},
    steps: 0,
    by_session: [],
    note: "",
    bytes_by_tool: { Read: 10 },
  };
  const b = {
    tool_breakdown: {},
    steps: 0,
    by_session: [],
    note: "",
    bytes_by_tool: { Read: 5, Grep: 3 },
  };
  assert.deepStrictEqual(mergeBytesByTool(a, b, null, undefined), {
    Read: 15,
    Grep: 3,
  });
  assert.deepStrictEqual(mergeBytesByTool(null, undefined), {});
  console.log("  ✓ mergeBytesByTool sums per-tool bytes across clients");
});

test("testSessionReadFailureReportsErrorCode", () => {
  const dir = mkdtempSync(join(tmpdir(), "fapony-baddb-"));
  const dbPath = join(dir, "opencode.db");
  writeFileSync(dbPath, "not a sqlite database at all");
  const orig = process.env.FAPONY_OPENCODE_DB;
  try {
    process.env.FAPONY_OPENCODE_DB = dbPath;
    const r = readPassiveUsage();
    assert.equal(r.session_count, 0);
    assert.equal(r.error, "opencode_read_failed", "failed read carries a code");

    process.env.FAPONY_OPENCODE_DB = join(dir, "missing.db");
    assert.equal(
      readPassiveUsage().error,
      undefined,
      "absent DB is not an error",
    );
    console.log(
      "  ✓ session read failure reports an error code, absent DB does not",
    );
  } finally {
    if (orig === undefined) delete process.env.FAPONY_OPENCODE_DB;
    else process.env.FAPONY_OPENCODE_DB = orig;
    rmSync(dir, { recursive: true, force: true });
  }
});

test("testBeginSnapshotOnlyUnderWal", () => {
  const dir = mkdtempSync(join(tmpdir(), "fapony-snap-"));
  try {
    for (const [mode, expected] of [
      ["WAL", true],
      ["DELETE", false],
    ] as Array<[string, boolean]>) {
      const p = join(dir, `${mode}.db`);
      const seed = new Database(p);
      seed.run(`PRAGMA journal_mode = ${mode}`);
      seed.run("CREATE TABLE t (x INTEGER)");
      seed.close();

      const db = new Database(p, { readonly: true });
      try {
        const open = beginSnapshot(db);
        assert.equal(open, expected, `${mode}: snapshot opened == ${expected}`);
        assert.deepStrictEqual(db.prepare("SELECT 1 AS n").get(), { n: 1 });
        endSnapshot(db, open);
        endSnapshot(db, false);
      } finally {
        db.close();
      }
    }
    console.log("  ✓ beginSnapshot pins a read snapshot under WAL only");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
