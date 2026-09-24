import { test } from "bun:test";
import assert from "node:assert";
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { readContextData } from "../../src/adapters/hooks/context-data.js";
import { withTempRepo } from "./helpers.js";

// PLAN-active-pain chunk 3 — edit-hint open-bug line + fire log.
// open = kind:"bug" with an id no close row refs (tombstone, not regex);
// exact files[] match only; the OPEN BUG line takes the mem slots first.

function writeLog(dir: string, rows: Record<string, unknown>[]): void {
  mkdirSync(join(dir, ".fapony/.memory"), { recursive: true });
  writeFileSync(
    join(dir, ".fapony/.memory/log.t.jsonl"),
    `${rows.map((r) => JSON.stringify(r)).join("\n")}\n`,
  );
}

const bug = (
  id: string,
  ts: string,
  text: string,
  files?: string[],
): Record<string, unknown> => ({
  ts,
  agent: "t",
  kind: "bug",
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

test("testOpenBugLineFiresWithCloseInstruction", () => {
  withTempRepo((dir) => {
    writeLog(dir, [bug("b1", "2026-09-19T00:00:00Z", "drift here", ["a.ts"])]);
    writeFileSync(join(dir, "a.ts"), "export const a = 1;\n");
    const ctx = readContextData(join(dir, "a.ts"), dir);
    assert.ok(ctx, "context must resolve");
    assert.deepEqual(ctx!.openBugIds, ["b1"]);
    assert.equal(ctx!.memLines.length, 1);
    assert.match(
      ctx!.memLines[0],
      /fapony mem: OPEN BUG b1 — "drift here" — ปิดด้วย fapony mem close b1 "<msg>" เมื่อแก้แล้ว/,
    );
  });
  console.log("  ✓ open bug → OPEN BUG line with close instruction");
});

test("testClosedBugStaysSilent", () => {
  withTempRepo((dir) => {
    writeLog(dir, [
      bug("b1", "2026-09-19T00:00:00Z", "drift here", ["a.ts"]),
      close("b1"),
    ]);
    writeFileSync(join(dir, "a.ts"), "export const a = 1;\n");
    const ctx = readContextData(join(dir, "a.ts"), dir);
    assert.ok(ctx, "context must resolve");
    assert.deepEqual(ctx!.openBugIds, []);
    assert.ok(
      !ctx!.memLines.some((l) => l.includes("OPEN BUG")),
      "closed bug must not emit OPEN BUG",
    );
  });
  console.log("  ✓ bug with a close row → no OPEN BUG line");
});

test("testBugWithoutFilesStaysSilent", () => {
  withTempRepo((dir) => {
    writeLog(dir, [bug("b1", "2026-09-19T00:00:00Z", "mentions a.ts in text")]);
    writeFileSync(join(dir, "a.ts"), "export const a = 1;\n");
    const ctx = readContextData(join(dir, "a.ts"), dir);
    assert.ok(ctx, "context must resolve");
    assert.deepEqual(
      ctx!.openBugIds,
      [],
      "fileless bug must not guess — exact files[] only",
    );
    assert.ok(
      !ctx!.memLines.some((l) => l.includes("OPEN BUG")),
      "fileless bug must not emit OPEN BUG",
    );
  });
  console.log("  ✓ bug row without files[] → no OPEN BUG line");
});

test("testOpenBugTakesSlotFirstWithoutExceedingCap", () => {
  withTempRepo((dir) => {
    writeLog(dir, [
      {
        ts: "2026-09-19T00:00:00Z",
        agent: "t",
        kind: "note",
        text: "note one",
        files: ["a.ts"],
      },
      bug("b1", "2026-09-18T00:00:00Z", "drift here", ["a.ts"]),
      {
        ts: "2026-09-17T00:00:00Z",
        agent: "t",
        kind: "decision",
        text: "old call",
        files: ["a.ts"],
      },
    ]);
    writeFileSync(join(dir, "a.ts"), "export const a = 1;\n");
    const ctx = readContextData(join(dir, "a.ts"), dir);
    assert.ok(ctx, "context must resolve");
    assert.equal(ctx!.memLines.length, 2, "cap stays at 2");
    assert.ok(
      ctx!.memLines[0].includes("OPEN BUG b1"),
      "open bug takes the first slot",
    );
    assert.equal(
      ctx!.memLines.filter((l) => l.includes("drift here")).length,
      1,
      "no duplicate of the open row as a normal line",
    );
  });
  console.log("  ✓ open bug first, cap held, no duplicate row");
});

test("testOpenBugFireLogOnEditHint", () => {
  withTempRepo((dir) => {
    writeLog(dir, [
      bug("b1", "2026-09-19T00:00:00Z", "drift here", ["lib.ts"]),
    ]);
    writeFileSync(join(dir, "lib.ts"), "export const value = 1;\n");
    writeFileSync(
      join(dir, "mid.ts"),
      'import { value } from "./lib.js";\nconsole.log(value);\n',
    );
    const session = join(dir, "sess-ob.jsonl");
    const run = Bun.spawnSync(
      ["bun", join(import.meta.dir, "..", "..", "fapony.ts"), "hook-edit-hint"],
      {
        cwd: dir,
        stdin: Buffer.from(
          JSON.stringify({
            cwd: dir,
            transcript_path: session,
            tool_input: { file_path: join(dir, "lib.ts") },
          }),
        ),
        stdout: "pipe",
        env: { ...process.env, FAPONY_STATE_DIR: dir },
      },
    );
    const out = JSON.parse(run.stdout.toString()) as {
      hookSpecificOutput: Record<string, string>;
    };
    assert.match(
      out.hookSpecificOutput.additionalContext ?? "",
      /OPEN BUG b1/,
      "edit hint carries the open bug line",
    );
    const logFiles = readdirSync(join(dir, "hint-log")).filter((f) =>
      f.endsWith(".jsonl"),
    );
    assert.equal(logFiles.length, 1, "exactly one worktree log file");
    const rows = readFileSync(join(dir, "hint-log", logFiles[0]), "utf-8")
      .split("\n")
      .filter(Boolean)
      .map((l) => JSON.parse(l) as Record<string, unknown>);
    const fires = rows.filter((r) => r.surface === "open-bug");
    assert.equal(fires.length, 1, "one open-bug fire row");
    assert.equal(fires[0].file, "lib.ts");
    assert.deepEqual(fires[0].ids, ["b1"]);
  });
  console.log("  ✓ edit hint shows OPEN BUG + logs surface open-bug");
});

// Cross-author measurement: the fire log needs the ids of every mem row shown
// (open bug + plain rows), so a later pass can join each id to its author.
test("testMemIdsListEveryRowShown", () => {
  withTempRepo((dir) => {
    writeLog(dir, [
      bug("b1", "2026-09-19T00:00:00Z", "drift here", ["a.ts"]),
      {
        ts: "2026-09-19T01:00:00Z",
        agent: "t",
        kind: "decision",
        id: "d1",
        text: "use x",
        files: ["a.ts"],
      },
    ]);
    writeFileSync(join(dir, "a.ts"), "export const a = 1;\n");
    const ctx = readContextData(join(dir, "a.ts"), dir);
    assert.deepEqual(ctx!.memIds, ["b1", "d1"]);
  });
  console.log("  ✓ memIds lists open bug + plain rows shown");
});
