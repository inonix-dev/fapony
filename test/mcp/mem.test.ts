// test/mcp/mem.test.ts — mem_find tool (PLAN-mem-mcp chunk 2, SPEC §1–§5)
import assert from "node:assert";
import {
  appendFileSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { memFind, toolMemFind } from "../../src/mcp/tools/mem.js";
import { parseToolResult } from "../../src/mcp/types.js";

function writeLog(dir: string, rows: object[]): string {
  const memDir = join(dir, ".fapony", ".memory");
  mkdirSync(memDir, { recursive: true });
  writeFileSync(
    join(memDir, "log.jsonl"),
    `${rows.map((r) => JSON.stringify(r)).join("\n")}\n`,
  );
  return memDir;
}

export function testMemFindReturnsAllKindsNoDefaultFilter(): void {
  // chunk 0 → A: every kind is live, so omitting kind must return
  // decision AND bookkeeping kinds (spec §5.2) — a default filter here
  // would enforce the retracted "deprecated" prose.
  const dir = mkdtempSync(join(tmpdir(), "fapony-memfind-"));
  try {
    writeLog(dir, [
      {
        ts: "2026-01-01T00:00:00.000Z",
        agent: "a",
        kind: "decision",
        text: "use tx",
      },
      {
        ts: "2026-01-02T00:00:00.000Z",
        agent: "a",
        kind: "synced",
        text: "sync",
      },
      {
        ts: "2026-01-03T00:00:00.000Z",
        agent: "a",
        kind: "next",
        text: "next up",
      },
      {
        ts: "2026-01-04T00:00:00.000Z",
        agent: "a",
        kind: "claim",
        text: "claim 1",
      },
    ]);
    const r = memFind({ worktree: dir });
    assert.equal(r.total, 4, "no default kind filter");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  console.log("  ✓ mem_find returns every kind (no default filter)");
}

export function testMemFindFiltersAndMatchesFiles(): void {
  const dir = mkdtempSync(join(tmpdir(), "fapony-memfind-"));
  try {
    writeLog(dir, [
      {
        ts: "2026-01-01T00:00:00.000Z",
        agent: "a",
        kind: "decision",
        text: "summary uses tx",
        spec: "apps/vela/src/booking/summary.ts",
      },
      {
        ts: "2026-01-02T00:00:00.000Z",
        agent: "a",
        kind: "bug",
        text: "unrelated",
      },
    ]);
    const r = memFind({
      worktree: dir,
      files: ["apps/vela/src/booking/summary.ts"],
    });
    assert.equal(r.total, 1, "files[] matches via text/spec/ref substring");
    assert.equal(r.rows[0].kind, "decision");

    const byKind = memFind({ worktree: dir, kind: ["bug"] });
    assert.equal(byKind.total, 1);
    assert.equal(byKind.rows[0].kind, "bug");

    const byText = memFind({ worktree: dir, text: "TX" }); // case-insensitive
    assert.equal(byText.total, 1);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  console.log("  ✓ mem_find filters by kind, text, and files[]");
}

export function testMemFindTotalVsLimitAndFailShapes(): void {
  // spec §4 fail examples: total-before-limit, memDir for existing mem,
  // skipped counts bad lines — never a silent empty.
  const dir = mkdtempSync(join(tmpdir(), "fapony-memfind-"));
  try {
    const rows = Array.from({ length: 30 }, (_, i) => ({
      ts: `2026-01-${String((i % 28) + 1).padStart(2, "0")}T00:00:00.000Z`,
      agent: "a",
      kind: "note",
      text: `row ${i}`,
    }));
    const memDir = writeLog(dir, rows);
    appendFileSync(join(memDir, "log.jsonl"), 'not-json\n{"kind":"x"}\n');

    const r = memFind({ worktree: dir, limit: 20 });
    assert.equal(r.total, 30, "total counts matches before limit");
    assert.equal(r.rows.length, 20, "rows respect limit");
    assert.equal(r.skipped, 2, "malformed lines counted, not swallowed");
    assert.equal(r.filesFound, 1);
    assert.ok(r.memDir, "memDir present when mem exists");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }

  // No mem at all → memDir:null, not just rows:[] (spec §4 table row 1)
  const empty = memFind({ worktree: "/nonexistent/wt-vela" });
  assert.equal(empty.memDir, null);
  assert.equal(empty.filesFound, 0);
  assert.deepEqual(empty.rows, []);
  console.log(
    "  ✓ mem_find distinguishes no-mem from no-match, counts skipped",
  );
}

export function testMemFindToolValidation(): void {
  // spec §4: bare/non-absolute worktree = explicit error, never silent empty
  const err = toolMemFind({ worktree: "wt-vela" });
  assert.equal(err.isError, true);

  const missing = toolMemFind({});
  assert.equal(missing.isError, true);

  const ok = parseToolResult(toolMemFind({ worktree: "/nonexistent" })) as {
    memDir: string | null;
  };
  assert.equal(ok.memDir, null);
  console.log("  ✓ mem_find rejects bare worktree names with a clear error");
}

// Rows written by `mem add --files` carry structured files[]; the query must
// hit them without the path appearing in the prose (regression 2026-09-19 —
// the field CLAUDE.md rule 7 calls mandatory was not searchable at all).
export function testMemFindMatchesStoredFiles(): void {
  const dir = mkdtempSync(join(tmpdir(), "fapony-memfind-files-"));
  try {
    writeLog(dir, [
      {
        ts: "2026-09-19T00:00:00.000Z",
        agent: "a",
        kind: "decision",
        text: "wrapper lives in the service layer now",
        files: ["src/deep/zone/handler.ts"],
      },
    ]);
    assert.equal(
      memFind({ worktree: dir, files: ["src/deep/zone/handler.ts"] }).total,
      1,
    );
    assert.equal(
      memFind({ worktree: dir, files: ["handler.ts"] }).total,
      1,
      "repo-relative suffix still matches",
    );
    assert.equal(memFind({ worktree: dir, files: ["src/other.ts"] }).total, 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  console.log("  ✓ mem_find matches rows by stored files[]");
}
