import { test } from "bun:test";
import assert from "node:assert";
import {
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { editHintFor, editTrackPath } from "../../src/hook.js";
import { editFixture, withEditState, withTempRepo } from "./helpers.js";

// --- Edit hint (importer count + once-per-session dedupe) ---

test("testEditHintFiresWithImporters", () => {
  withTempRepo((dir) => {
    withEditState(() => {
      const { lib } = editFixture(dir);
      const hint = editHintFor({
        filePath: lib,
        cwd: dir,
        session: "sess-eh-1",
      });
      assert.ok(hint, "file with importers must get a hint");
      assert.match(hint ?? "", /lib\.ts has 2 importers/);
      assert.match(hint ?? "", /review-seed --files lib\.ts/);
      assert.match(hint ?? "", /--callers/);
    });
  });
  console.log(
    "  ✓ edit hint names the importer count with review-seed pointer",
  );
});

test("testEditHintSilentZeroImporters", () => {
  withTempRepo((dir) => {
    withEditState(() => {
      const { lone } = editFixture(dir);
      const session = "sess-eh-zero";
      assert.equal(
        editHintFor({ filePath: lone, cwd: dir, session }),
        null,
        "file nobody imports must stay silent",
      );
      assert.ok(
        !existsSync(editTrackPath(session)),
        "zero-importer file must not write the track log",
      );
    });
  });
  console.log("  ✓ edit hint stays silent with 0 importers, writes nothing");
});

test("testEditHintSkipsNonSourceAndMissing", () => {
  withTempRepo((dir) => {
    withEditState(() => {
      editFixture(dir);
      const md = join(dir, "NOTES.md");
      writeFileSync(md, "x".repeat(48_000));
      assert.equal(
        editHintFor({ filePath: md, cwd: dir, session: "s" }),
        null,
        "non-source ext must stay silent",
      );
      assert.equal(
        editHintFor({ filePath: join(dir, "new.ts"), cwd: dir, session: "s" }),
        null,
        "new/unsaved file must stay silent",
      );
      assert.equal(editHintFor({ filePath: null, cwd: dir }), null);
      assert.equal(editHintFor({ filePath: "", cwd: dir }), null);
      const outside = mkdtempSync(join(tmpdir(), "fapony-eh-out-"));
      try {
        const op = join(outside, "o.ts");
        writeFileSync(op, "export const o = 1;\n");
        assert.equal(
          editHintFor({ filePath: op, cwd: dir, session: "s" }),
          null,
        );
      } finally {
        rmSync(outside, { recursive: true, force: true });
      }
    });
  });
  console.log("  ✓ edit hint skips non-source, new, missing, outside files");
});

test("testEditHintNeedsGitRepo", () => {
  const dir = mkdtempSync(join(tmpdir(), "fapony-eh-norepo-"));
  try {
    const p = join(dir, "a.ts");
    writeFileSync(p, "export const x = 1;\n");
    withEditState(() => {
      assert.equal(editHintFor({ filePath: p, cwd: dir, session: "s" }), null);
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  console.log("  ✓ edit hint stays silent outside a git repo");
});

test("testEditHintDedupesPerSessionPerFile", () => {
  withTempRepo((dir) => {
    withEditState(() => {
      const { lib, top } = editFixture(dir);
      const s1 = "sess-eh-a";
      const s2 = "sess-eh-b";
      assert.ok(
        editHintFor({ filePath: lib, cwd: dir, session: s1 }),
        "first edit fires",
      );
      assert.equal(
        editHintFor({ filePath: lib, cwd: dir, session: s1 }),
        null,
        "repeat edit of the same file in the same session stays silent",
      );
      assert.ok(
        editHintFor({ filePath: lib, cwd: dir, session: s2 }),
        "no cross-session leak",
      );
      assert.ok(
        editHintFor({ filePath: top, cwd: dir, session: s1 }),
        "dedupe is per file, not per session",
      );
      assert.equal(
        editHintFor({ filePath: top, cwd: dir, session: s1 }),
        null,
        "second file also dedupes on repeat",
      );
    });
  });
  console.log("  ✓ edit hint fires once per (session, file)");
});

test("testEditHintFiresWithoutSession", () => {
  withTempRepo((dir) => {
    withEditState(() => {
      const { lib } = editFixture(dir);
      assert.ok(editHintFor({ filePath: lib, cwd: dir }), "fires");
      assert.ok(
        editHintFor({ filePath: lib, cwd: dir }),
        "fires again with no session to dedupe against",
      );
    });
  });
  console.log("  ✓ edit hint fires (no dedupe) when the session is unknown");
});

// --- Edit hint e2e (spawn process) ---

test("testEditHintClaudeOutputShape", () => {
  withTempRepo((dir) => {
    const lib = join(dir, "lib.ts");
    writeFileSync(lib, "export const value = 1;\n");
    writeFileSync(
      join(dir, "mid.ts"),
      'import { value } from "./lib.js";\nconsole.log(value);\n',
    );
    const run = (payload: unknown) =>
      Bun.spawnSync(
        [
          "bun",
          join(import.meta.dir, "..", "..", "fapony.ts"),
          "hook-edit-hint",
        ],
        {
          cwd: dir,
          stdin: Buffer.from(JSON.stringify(payload)),
          stdout: "pipe",
          env: { ...process.env, FAPONY_STATE_DIR: dir },
        },
      );
    const session = join(dir, "sess-eh.jsonl");
    const first = run({
      cwd: dir,
      transcript_path: session,
      tool_input: { file_path: lib },
    });
    const out = JSON.parse(first.stdout.toString()) as {
      hookSpecificOutput: Record<string, string>;
    };
    assert.equal(out.hookSpecificOutput.hookEventName, "PreToolUse");
    assert.match(
      out.hookSpecificOutput.additionalContext ?? "",
      /lib\.ts has 1 importer/,
    );
    assert.match(
      out.hookSpecificOutput.additionalContext ?? "",
      /review-seed --files lib\.ts/,
    );
    assert.ok(
      !JSON.stringify(out).includes("permissionDecision"),
      "annotate-only: no permissionDecision may ever appear",
    );
    // one "edit" surface row in the hint log
    let logFiles: string[] = [];
    try {
      logFiles = readdirSync(join(dir, "hint-log")).filter((f) =>
        f.endsWith(".jsonl"),
      );
    } catch {
      logFiles = [];
    }
    assert.equal(logFiles.length, 1, "exactly one worktree log file");
    const rows = readFileSync(join(dir, "hint-log", logFiles[0]), "utf-8")
      .split("\n")
      .filter(Boolean)
      .map((l) => JSON.parse(l) as Record<string, unknown>);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].surface, "edit");
    assert.equal(rows[0].file, "lib.ts");
    // repeat edit in the same session: dedupe → no output, no second row
    const second = run({
      cwd: dir,
      transcript_path: session,
      tool_input: { file_path: lib },
    });
    assert.equal(
      second.stdout.toString().trim(),
      "",
      "repeat edit stays silent",
    );
    const rowsAfter = readFileSync(join(dir, "hint-log", logFiles[0]), "utf-8")
      .split("\n")
      .filter(Boolean);
    assert.equal(rowsAfter.length, 1, "dedupe must not log a second row");
    // zero-importer file: silent, no new row
    const lone = join(dir, "lone.ts");
    writeFileSync(lone, "export const alone = 1;\n");
    const third = run({
      cwd: dir,
      transcript_path: session,
      tool_input: { file_path: lone },
    });
    assert.equal(
      third.stdout.toString().trim(),
      "",
      "0 importers stays silent",
    );
  });
  console.log("  ✓ edit hint claude output = additionalContext + edit log row");
});
