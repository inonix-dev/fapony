import { test } from "bun:test";
import assert from "node:assert";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  computeHintImpact,
  READ_HINT_MIN_BYTES,
  readContextLines,
  readHintFor,
  readTrackPath,
  recordHintFire,
  rereadHintFor,
  sessionKey,
} from "../../src/hook.js";
import { padFile, withStateDir, withTempRepo } from "./helpers.js";

// --- Read hint (PreToolUse annotate) ---

test("testReadHintAnnotatesLargeFullRead", () => {
  withTempRepo((dir) => {
    const p = padFile(dir, "big.ts");
    const hint = readHintFor({ filePath: p, cwd: dir });
    assert.ok(hint, "large full read must get a hint");
    assert.match(hint ?? "", /big\.ts is \d+ lines/);
    assert.match(hint ?? "", /review-seed --files big\.ts/);
    assert.match(hint ?? "", /\n.*entry:\d+/);
  });
  console.log("  ✓ read hint annotates large full-file read");
});

test("testReadHintSkipsCheapReads", () => {
  withTempRepo((dir) => {
    const big = padFile(dir, "big.ts");
    assert.equal(
      readHintFor({ filePath: big, limit: 50, cwd: dir }),
      null,
      "bounded read must stay silent",
    );
    assert.ok(
      readHintFor({ filePath: big, limit: 5000, cwd: dir }),
      "large limit must still hint",
    );
    const small = join(dir, "small.ts");
    writeFileSync(small, "export const tiny = 1;\n");
    assert.equal(readHintFor({ filePath: small, cwd: dir }), null);
    const md = join(dir, "README.md");
    writeFileSync(md, "x".repeat(READ_HINT_MIN_BYTES * 2));
    assert.equal(readHintFor({ filePath: md, cwd: dir }), null);
    assert.equal(
      readHintFor({ filePath: join(dir, "nope.ts"), cwd: dir }),
      null,
    );
    assert.equal(readHintFor({ filePath: null, cwd: dir }), null);
  });
  console.log(
    "  ✓ read hint skips bounded reads, small files, non-source, missing",
  );
});

test("testReadHintNeedsGitRepo", () => {
  const dir = mkdtempSync(join(tmpdir(), "fapony-rh-norepo-"));
  try {
    const p = padFile(dir, "big.ts");
    assert.equal(readHintFor({ filePath: p, cwd: dir }), null);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  console.log("  ✓ read hint stays silent outside a git repo");
});

// --- Re-read hint (mtime heuristic — annotate only) ---

test("testRereadHintFiresOnUnchangedRepeat", () => {
  withStateDir((dir) => {
    const p = join(dir, "small.ts");
    writeFileSync(p, "export const x = 1;\n");
    const session = "/tmp/transcripts/sess-a.jsonl";
    assert.equal(
      sessionKey(session),
      "sess-a",
      "key is the transcript basename",
    );
    assert.equal(
      rereadHintFor({ filePath: p, cwd: dir, session }),
      null,
      "first read must stay silent",
    );
    const hint = rereadHintFor({ filePath: p, cwd: dir, session });
    assert.ok(hint, "second unchanged read must hint");
    assert.match(hint ?? "", /already read small\.ts 1\u00d7/);
    assert.match(hint ?? "", /grep the line range/);
    assert.equal(
      rereadHintFor({
        filePath: p,
        cwd: dir,
        session: "/tmp/transcripts/sess-b.jsonl",
      }),
      null,
      "no cross-session leak",
    );
    assert.equal(
      rereadHintFor({ filePath: p, cwd: dir, session, limit: 5 }),
      null,
      "bounded read must stay silent",
    );
    assert.equal(
      rereadHintFor({ filePath: p, cwd: dir, session, offset: 2 }),
      null,
      "offset read must stay silent",
    );
    assert.ok(readTrackPath(session), "read log must be written");
  });
  console.log("  ✓ re-read hint fires on an unchanged repeat, per session");
});

test("testRereadHintSilentAfterEdit", () => {
  withStateDir((dir) => {
    const p = join(dir, "edit.ts");
    writeFileSync(p, "export const x = 1;\n");
    const session = "sess-edit";
    assert.equal(rereadHintFor({ filePath: p, cwd: dir, session }), null);
    writeFileSync(p, "export const x = 2;\n");
    const later = new Date(Date.now() + 5000);
    utimesSync(p, later, later);
    assert.equal(
      rereadHintFor({ filePath: p, cwd: dir, session }),
      null,
      "mtime moved = new content = stay silent",
    );
    assert.ok(
      rereadHintFor({ filePath: p, cwd: dir, session }),
      "unchanged since the new mtime must hint",
    );
  });
  console.log("  ✓ re-read hint stays silent after the file changes");
});

test("testRereadHintKillSwitch", () => {
  const origState = process.env.FAPONY_STATE_DIR;
  const origKill = process.env.FAPONY_NO_REREAD_HINT;
  const dir = mkdtempSync(join(tmpdir(), "fapony-rr-"));
  process.env.FAPONY_STATE_DIR = dir;
  process.env.FAPONY_NO_REREAD_HINT = "1";
  try {
    const p = join(dir, "k.ts");
    writeFileSync(p, "export const x = 1;\n");
    const session = "sess-kill";
    assert.equal(rereadHintFor({ filePath: p, cwd: dir, session }), null);
    assert.equal(
      rereadHintFor({ filePath: p, cwd: dir, session }),
      null,
      "kill switch = always silent",
    );
    assert.ok(
      !existsSync(readTrackPath(session)),
      "kill switch must not write the log",
    );
  } finally {
    if (origState === undefined) delete process.env.FAPONY_STATE_DIR;
    else process.env.FAPONY_STATE_DIR = origState;
    if (origKill === undefined) delete process.env.FAPONY_NO_REREAD_HINT;
    else process.env.FAPONY_NO_REREAD_HINT = origKill;
    rmSync(dir, { recursive: true, force: true });
  }
  console.log("  ✓ re-read hint kill switch silences and stops tracking");
});

// --- Read hint e2e (spawn process) ---

test("testReadHintClaudeOutputShape", () => {
  withTempRepo((dir) => {
    const p = padFile(dir, "big.ts");
    const proc = Bun.spawnSync(
      ["bun", join(import.meta.dir, "..", "..", "fapony.ts"), "hook-read-hint"],
      {
        cwd: dir,
        stdin: Buffer.from(
          JSON.stringify({ cwd: dir, tool_input: { file_path: p } }),
        ),
        stdout: "pipe",
        env: { ...process.env, FAPONY_STATE_DIR: dir },
      },
    );
    const out = JSON.parse(proc.stdout.toString()) as {
      hookSpecificOutput: Record<string, string>;
    };
    assert.equal(out.hookSpecificOutput.hookEventName, "PreToolUse");
    assert.ok(typeof out.hookSpecificOutput.additionalContext === "string");
    assert.ok(
      !JSON.stringify(out).includes("permissionDecision"),
      "annotate-only: no permissionDecision may ever appear",
    );
  });
  console.log("  ✓ read hint claude output = additionalContext, no decision");
});

// --- Debt + mem context lines (PLAN-convention-debt chunk 4) ---

test("testReadContextShowsDebtBeforeFix", () => {
  withTempRepo((dir) => {
    mkdirSync(join(dir, ".fapony"), { recursive: true });
    writeFileSync(
      join(dir, ".fapony", "conventions.json"),
      JSON.stringify({
        conventions: [
          {
            id: "mutation-hooks",
            rule: "use useAppForm instead of raw useMutation",
            where: "src",
            stale: "\\buseMutation\\(",
            checker: null,
          },
        ],
      }),
    );
    mkdirSync(join(dir, "src"), { recursive: true });
    const p = join(dir, "src", "dirty.ts");
    writeFileSync(p, "export const m = () => useMutation(fn);\n");
    const lines = readContextLines(p, dir);
    assert.equal(lines.length, 1);
    assert.match(lines[0], /fapony debt: \[mutation-hooks\]/);
    const clean = join(dir, "src", "clean.ts");
    writeFileSync(clean, "export const ok = 1;\n");
    assert.deepEqual(readContextLines(clean, dir), []);
  });
  console.log(
    "  ✓ read context → debt line before the fix, silence on clean files",
  );
});

test("testReadContextMemRowsByFilesAndPath", () => {
  withTempRepo((dir) => {
    mkdirSync(join(dir, ".fapony/.memory"), { recursive: true });
    mkdirSync(join(dir, "src"), { recursive: true });
    const row = (ts: string, text: string, files?: string[]) =>
      JSON.stringify({
        ts,
        agent: "t",
        kind: "bug",
        text,
        ...(files ? { files } : []),
      });
    const logRows = [
      row("2026-09-17T00:00:00Z", "money drifted via toLocaleString", [
        "src/bill.tsx",
      ]),
      row("2026-09-16T00:00:00Z", "old row mentions src/form.tsx by path"),
      row("2026-09-15T00:00:00Z", "unrelated row about nothing"),
    ].join("\n");
    writeFileSync(join(dir, ".fapony/.memory/log.t.jsonl"), `${logRows}\n`);
    writeFileSync(join(dir, "src/bill.tsx"), "x");
    writeFileSync(join(dir, "src/form.tsx"), "x");
    const byFiles = readContextLines(join(dir, "src/bill.tsx"), dir);
    assert.equal(byFiles.length, 1);
    assert.match(byFiles[0], /fapony mem: 2026-09-17 bug/);
    const byPath = readContextLines(join(dir, "src/form.tsx"), dir);
    assert.equal(
      byPath.length,
      1,
      "old rows without files[] still match by full path",
    );
    assert.match(byPath[0], /2026-09-16/);
    const none = readContextLines(join(dir, "src/other.tsx"), dir);
    assert.deepEqual(none, [], "unmentioned file stays silent");
  });
  console.log("  ✓ read context → mem rows surface by files[] or full path");
});

test("testReadContextBasenameAmbiguityStaysSilent", () => {
  withTempRepo((dir) => {
    mkdirSync(join(dir, "src/a"), { recursive: true });
    mkdirSync(join(dir, "src/b"), { recursive: true });
    mkdirSync(join(dir, ".fapony/.memory"), { recursive: true });
    writeFileSync(join(dir, "src/a/index.ts"), "x");
    writeFileSync(join(dir, "src/b/index.ts"), "x");
    const memRow = JSON.stringify({
      ts: "2026-09-17T00:00:00Z",
      agent: "t",
      kind: "note",
      text: "watch out for index.ts",
    });
    writeFileSync(join(dir, ".fapony/.memory/log.t.jsonl"), `${memRow}\n`);
    const lines = readContextLines(join(dir, "src/a/index.ts"), dir);
    assert.equal(lines.length, 0, "ambiguous basename must not guess");
  });
  console.log(
    "  ✓ read context → ambiguous basename stays silent, never guesses",
  );
});

test("testReadContextCombinedCapAndOutsideRepo", () => {
  withTempRepo((dir) => {
    mkdirSync(join(dir, ".fapony"), { recursive: true });
    writeFileSync(
      join(dir, ".fapony", "conventions.json"),
      JSON.stringify({
        conventions: [
          { id: "a", rule: "r1", where: "src", stale: "aaa", checker: null },
          { id: "b", rule: "r2", where: "src", stale: "bbb", checker: null },
          { id: "c", rule: "r3", where: "src", stale: "ccc", checker: null },
          { id: "d", rule: "r4", where: "src", stale: "ddd", checker: null },
        ],
      }),
    );
    mkdirSync(join(dir, "src"), { recursive: true });
    writeFileSync(join(dir, "src/all.ts"), "aaa bbb ccc ddd\n");
    const lines = readContextLines(join(dir, "src/all.ts"), dir);
    assert.ok(
      lines.length <= 5,
      `total context lines capped, got ${lines.length}`,
    );
    assert.equal(lines.filter((l) => l.startsWith("fapony debt")).length, 3);
    const out = mkdtempSync(join(tmpdir(), "fapony-ctx-norepo-"));
    try {
      writeFileSync(join(out, "f.ts"), "aaa bbb ccc ddd\n");
      assert.deepEqual(readContextLines(join(out, "f.ts"), out), []);
    } finally {
      rmSync(out, { recursive: true, force: true });
    }
  });
  console.log("  ✓ read context → ≤5 lines, silent outside a repo");
});

// Regression 2026-09-22 (bug muc9q47r): the hint resolved the mem log from the
// repo root, so in a monorepo whose log is app-scoped it saw only an
// out-of-scope candidate and went silent for files sitting right under that log.
test("testReadContextFindsAppScopedLogInMonorepo", () => {
  withTempRepo((repo) => {
    mkdirSync(join(repo, "apps/web/src"), { recursive: true });
    mkdirSync(join(repo, "apps/api/src"), { recursive: true });
    mkdirSync(join(repo, "apps/web/.fapony/.memory"), { recursive: true });
    writeFileSync(join(repo, "apps/web/src/bill.tsx"), "x");
    writeFileSync(join(repo, "apps/api/src/bill.tsx"), "x");
    writeFileSync(
      join(repo, "apps/web/.fapony/.memory/log.t.jsonl"),
      `${JSON.stringify({
        ts: "2026-09-17T00:00:00Z",
        agent: "t",
        kind: "bug",
        text: "web bill drifted",
        files: ["apps/web/src/bill.tsx"],
      })}\n`,
    );

    // cwd = repo root (the agent opened at the top), file inside the app
    const hit = readContextLines(join(repo, "apps/web/src/bill.tsx"), repo);
    assert.equal(
      hit.length,
      1,
      "app-scoped log must be found from the file's dir, not the root",
    );
    assert.match(hit[0], /fapony mem: 2026-09-17 bug/);

    // a same-named file in a sibling app must not pick up the other app's row
    const other = readContextLines(join(repo, "apps/api/src/bill.tsx"), repo);
    assert.deepEqual(other, [], "no cross-app leak");
  });
  console.log(
    "  ✓ read context resolves the app-scoped log from the file's dir",
  );
});

// --- Hint impact ---

test("testComputeHintImpact", () => {
  withTempRepo((dir) => {
    mkdirSync(join(dir, ".fapony"), { recursive: true });
    writeFileSync(
      join(dir, ".fapony", "conventions.json"),
      JSON.stringify({
        conventions: [
          {
            id: "no-use-mutation",
            rule: "use useAppForm instead of raw useMutation",
            where: "src",
            stale: "\\buseMutation\\(",
            checker: null,
          },
        ],
      }),
    );
    mkdirSync(join(dir, "src"), { recursive: true });
    const p = join(dir, "src", "dirty.ts");
    writeFileSync(p, "export const m = () => useMutation(fn);\n");

    process.env.FAPONY_STATE_DIR = dir;
    try {
      recordHintFire({
        ts: new Date().toISOString(),
        worktree: dir,
        surface: "debt",
        file: "src/dirty.ts",
        count: 1,
        ids: ["no-use-mutation"],
      });

      const before = computeHintImpact();
      assert.equal(before.fired, 1);
      assert.equal(before.debt.shown, 1);
      assert.equal(before.debt.resolved, 0);

      writeFileSync(p, "export const ok = 1;\n");

      const after = computeHintImpact();
      assert.equal(after.debt.shown, 1);
      assert.equal(after.debt.resolved, 1);
    } finally {
      delete process.env.FAPONY_STATE_DIR;
    }
  });
  console.log("  ✓ computeHintImpact: debt precision counts resolved ids");
});

test("testComputeHintImpactNoLog", () => {
  process.env.FAPONY_STATE_DIR = mkdtempSync(join(tmpdir(), "fapony-no-log-"));
  try {
    const impact = computeHintImpact();
    assert.equal(impact.fired, 0);
    assert.equal(impact.debt.shown, 0);
  } finally {
    delete process.env.FAPONY_STATE_DIR;
  }
  console.log("  ✓ computeHintImpact: no log → zero counts, no error");
});
