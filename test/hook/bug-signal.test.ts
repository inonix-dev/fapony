import { test } from "bun:test";
import assert from "node:assert";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { bugSignalFromTranscript, decideStop } from "../../src/hook.js";
import { base } from "./fixtures.js";
import { withTempRepo, writeTranscript } from "./helpers.js";

// --- Bug-signal block (PLAN-bug-row-checker) ---

test("testDecideStopBlocksOnBugSignalWithoutRow", () => {
  const reason = decideStop({
    ...base,
    commits: 0,
    bugSignal: "เจอบั๊ก",
    bugRowSinceStart: false,
  });
  assert.ok(reason, "bug signal without bug row must block");
  assert.ok(reason.includes("เจอบั๊ก"), "reason names the matched word");
  assert.ok(reason.includes("kind:bug"), "reason specifies kind:bug");
  assert.ok(
    reason.includes("fapony mem add bug"),
    "reason names the bug-specific command",
  );
});

test("testDecideStopAllowsBugSignalWithRow", () => {
  assert.strictEqual(
    decideStop({
      ...base,
      commits: 0,
      bugSignal: "เจอบั๊ก",
      bugRowSinceStart: true,
    }),
    null,
    "bug signal with bug row must allow",
  );
});

test("testDecideStopBugBlockIndependentOfCommits", () => {
  const withCommits = decideStop({
    ...base,
    commits: 3,
    bugSignal: "เจอบั๊ก",
    bugRowSinceStart: false,
  });
  const withoutCommits = decideStop({
    ...base,
    commits: 0,
    bugSignal: "เจอบั๊ก",
    bugRowSinceStart: false,
  });
  assert.ok(withCommits, "blocks with commits");
  assert.ok(withoutCommits, "blocks without commits too");
});

test("testDecideStopNoBugSignalAllows", () => {
  assert.strictEqual(
    decideStop({
      ...base,
      commits: 0,
      bugSignal: null,
      bugRowSinceStart: false,
    }),
    null,
    "no bug signal + no commits = allow",
  );
  assert.strictEqual(
    decideStop({ ...base, commits: 0 }),
    null,
    "undefined bug signal = allow",
  );
});

test("testDecideStopBugBlockMessageShort", () => {
  const reason = decideStop({
    ...base,
    commits: 0,
    bugSignal: "เจอบั๊ก",
    bugRowSinceStart: false,
  });
  assert.ok(reason);
  assert.ok(reason.split("\n").length <= 6, "bug block message stays short");
});

test("testDecideStopCommitBlockWidensWithBugSignal", () => {
  const reason = decideStop({
    ...base,
    commits: 2,
    bugSignal: "เจอบั๊ก",
    bugRowSinceStart: true,
    memLastTs: "2026-09-15T00:00:00Z",
  });
  assert.ok(reason, "commit block must fire");
  assert.ok(
    reason.includes("kind:bug"),
    "commit block nudge must mention kind:bug",
  );
  assert.ok(
    reason.includes("เจอบั๊ก"),
    "commit block nudge must name the marker word",
  );
  assert.ok(
    reason.includes("commit(s) landed"),
    "must still carry the commit block header",
  );
});

test("testDecideStopCommitBlockNoWidenWithoutBugSignal", () => {
  const reason = decideStop({
    ...base,
    commits: 1,
    memLastTs: "2026-09-15T00:00:00Z",
  });
  assert.ok(reason);
  assert.ok(
    !reason.includes("kind:bug"),
    "commit block without bug signal must not mention kind:bug",
  );
});

// --- Transcript scanner (bugSignalFromTranscript) ---

test("testBugSignalFromTranscriptFindsMarker", () => {
  withTempRepo((dir) => {
    const ts = writeTranscript(dir, [
      {
        message: {
          role: "assistant",
          created_at: "2026-09-22T10:00:00Z",
          content: [
            { type: "text", text: "ลอง check แล้ว เจอบั๊กจริงใน totalsRow" },
          ],
        },
      },
    ]);
    const signal = bugSignalFromTranscript(
      ts,
      Date.parse("2026-09-22T09:00:00Z"),
    );
    assert.equal(signal, "เจอบั๊ก", "must find the marker word");
  });
  console.log("  ✓ bugSignalFromTranscript finds marker in assistant text");
});

test("testBugSignalFromTranscriptSkipsOldMessages", () => {
  withTempRepo((dir) => {
    const ts = writeTranscript(dir, [
      {
        message: {
          role: "assistant",
          created_at: "2026-09-21T10:00:00Z",
          content: [{ type: "text", text: "เจอบั๊กจริงนะ" }],
        },
      },
    ]);
    const signal = bugSignalFromTranscript(
      ts,
      Date.parse("2026-09-22T09:00:00Z"),
    );
    assert.strictEqual(signal, null, "old messages must be skipped");
  });
  console.log(
    "  ✓ bugSignalFromTranscript skips messages before session start",
  );
});

test("testBugSignalFromTranscriptIgnoresUserMessages", () => {
  withTempRepo((dir) => {
    const ts = writeTranscript(dir, [
      {
        message: {
          role: "user",
          created_at: "2026-09-22T10:00:00Z",
          content: [{ type: "text", text: "ช่วยเจอบั๊กให้หน่อย" }],
        },
      },
    ]);
    const signal = bugSignalFromTranscript(
      ts,
      Date.parse("2026-09-22T09:00:00Z"),
    );
    assert.strictEqual(signal, null, "user messages must be ignored");
  });
  console.log("  ✓ bugSignalFromTranscript ignores user messages");
});

test("testBugSignalFromTranscriptSkipsToolUse", () => {
  withTempRepo((dir) => {
    const ts = writeTranscript(dir, [
      {
        message: {
          role: "assistant",
          created_at: "2026-09-22T10:00:00Z",
          content: [
            { type: "tool_use", name: "mem_add", input: { kind: "bug" } },
          ],
        },
      },
    ]);
    const signal = bugSignalFromTranscript(
      ts,
      Date.parse("2026-09-22T09:00:00Z"),
    );
    assert.strictEqual(signal, null, "tool_use content must be skipped");
  });
  console.log("  ✓ bugSignalFromTranscript skips tool_use content");
});

test("testBugSignalFromTranscriptSilentOnMissingFile", () => {
  const signal = bugSignalFromTranscript(
    "/tmp/nonexistent-transcript.jsonl",
    Date.parse("2026-09-22T09:00:00Z"),
  );
  assert.strictEqual(signal, null, "missing file must not throw");
  console.log("  ✓ bugSignalFromTranscript silent on missing file");
});

test("testBugSignalFromTranscriptSkipsNonAnnouncementWords", () => {
  withTempRepo((dir) => {
    const ts = writeTranscript(dir, [
      {
        message: {
          role: "assistant",
          created_at: "2026-09-22T10:00:00Z",
          content: [
            {
              type: "text",
              text: "โค้ดมี pre-existing issue ที่ dies silently",
            },
          ],
        },
      },
    ]);
    const signal = bugSignalFromTranscript(
      ts,
      Date.parse("2026-09-22T09:00:00Z"),
    );
    assert.strictEqual(
      signal,
      null,
      "symptom words (pre-existing, silently) must not trigger",
    );
  });
  console.log("  ✓ bugSignalFromTranscript ignores non-announcement words");
});

test("testBugSignalFromTranscriptCapsLargeFile", () => {
  withTempRepo((dir) => {
    const bigPath = join(dir, "big.jsonl");
    const pad = "x".repeat(1024);
    const lines = Array.from({ length: 12000 }, () => pad).join("\n");
    writeFileSync(bigPath, lines);
    const signal = bugSignalFromTranscript(bigPath, 0);
    assert.strictEqual(signal, null, "> 10MB file must be skipped");
  });
  console.log("  ✓ bugSignalFromTranscript caps large transcripts at 10MB");
});

test("testBugBlockKillSwitch", () => {
  withTempRepo((dir) => {
    const ts = writeTranscript(dir, [
      {
        message: {
          role: "assistant",
          created_at: "2026-09-22T10:00:00Z",
          content: [{ type: "text", text: "เจอบั๊กจริงใน totalsRow" }],
        },
      },
    ]);
    const origKill = process.env.FAPONY_NO_BUG_BLOCK;
    process.env.FAPONY_NO_BUG_BLOCK = "1";
    try {
      bugSignalFromTranscript(ts, Date.parse("2026-09-22T09:00:00Z"));
      const reason = decideStop({
        ...base,
        commits: 0,
        bugSignal: null,
        bugRowSinceStart: false,
      });
      assert.strictEqual(reason, null, "kill switch → no bug block");
    } finally {
      if (origKill === undefined) delete process.env.FAPONY_NO_BUG_BLOCK;
      else process.env.FAPONY_NO_BUG_BLOCK = origKill;
    }
  });
  console.log("  ✓ FAPONY_NO_BUG_BLOCK=1 disables bug-signal block");
});
