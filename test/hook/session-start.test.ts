import { test } from "bun:test";
import assert from "node:assert";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { capContext, SESSION_START_MAX_CHARS } from "../../src/hook.js";
import { sessionStartPluginSource } from "../../src/install/opencode.js";
import { withTempRepo } from "./helpers.js";

// SessionStart context is injected whole — a repo with a long open list must
// not push the session's own prompt out of the way.
test("testSessionStartContextIsCapped", () => {
  const short = "one line";
  assert.equal(capContext(short), short, "short output passes through");
  const long = `${"x".repeat(50)}\n`.repeat(200);
  const capped = capContext(long);
  assert.ok(capped.length <= SESSION_START_MAX_CHARS + 120, "stays near cap");
  assert.ok(capped.includes("truncated"), "says it was cut");
  assert.ok(
    capped.includes("fapony mem find"),
    "points at capped recall, not the full dump",
  );
  assert.ok(
    !capped.includes("mem kickoff"),
    "never sends the agent back to the uncapped dump",
  );
  // The actionable section is the last one — a plain head-cut would drop it.
  const withNext = `${long}\n## next up\n  [1] bug #abc — fix the thing\n`;
  const keptNext = capContext(withNext);
  assert.ok(keptNext.includes("[1] bug #abc"), "keeps the next-up section");
  assert.ok(keptNext.includes("truncated"), "still says it was cut");
  assert.ok(
    keptNext.length <= SESSION_START_MAX_CHARS + 200,
    "keeping next up stays within budget",
  );
  console.log("  ✓ session-start context is capped with an honest marker");
});

test("testHookSessionStartSilentWithoutMemLog", () => {
  // Bug mub2ezhi: the no-mem-log guard is the whole reason the OpenCode plugin
  // now spawns this hook instead of `mem kickoff` — kickoff exits 0 and prints
  // "# <path> — 0 entries" in a repo with no log, and that header was landing
  // in the first dispatch of every session. Silence must be a clean exit with
  // zero stdout, because whatever lands here is injected as session context.
  withTempRepo((dir) => {
    const p = Bun.spawnSync(
      [
        "bun",
        join(import.meta.dir, "..", "..", "fapony.ts"),
        "hook-session-start",
      ],
      {
        cwd: dir,
        stdin: Buffer.from(JSON.stringify({ cwd: dir })),
        stdout: "pipe",
        stderr: "pipe",
        env: { ...process.env, FAPONY_STATE_DIR: join(dir, ".state") },
      },
    );
    assert.equal(p.exitCode, 0, "silence is a clean exit, not an error");
    assert.equal(p.stdout.toString().trim(), "", "no mem log = no context");
  });

  // The same hook emits the documented SessionStart JSON once a log exists.
  withTempRepo((dir) => {
    mkdirSync(join(dir, ".fapony/.memory"), { recursive: true });
    const row = JSON.stringify({
      ts: "2026-09-17T00:00:00Z",
      agent: "t",
      kind: "note",
      text: "remember this",
      files: ["README.md"],
    });
    writeFileSync(join(dir, ".fapony/.memory/log.t.jsonl"), `${row}\n`);
    const p = Bun.spawnSync(
      [
        "bun",
        join(import.meta.dir, "..", "..", "fapony.ts"),
        "hook-session-start",
      ],
      {
        cwd: dir,
        stdin: Buffer.from(JSON.stringify({ cwd: dir })),
        stdout: "pipe",
        stderr: "pipe",
        env: { ...process.env, FAPONY_STATE_DIR: join(dir, ".state") },
      },
    );
    assert.equal(p.exitCode, 0);
    const out = JSON.parse(p.stdout.toString()) as {
      hookSpecificOutput: Record<string, string>;
    };
    assert.equal(out.hookSpecificOutput.hookEventName, "SessionStart");
    assert.ok(
      typeof out.hookSpecificOutput.additionalContext === "string" &&
        out.hookSpecificOutput.additionalContext.length > 0,
      "carries the kickoff context",
    );
  });
  console.log("  ✓ hook-session-start: silent with no mem log, JSON with one");
});

test("testSessionStartPluginSource", () => {
  const src = sessionStartPluginSource("/install/root");
  assert.ok(
    src.includes("/install/root/src/hook.ts"),
    "imports the shared hook module",
  );
  assert.ok(src.includes("/install/root/fapony.ts"), "bakes the CLI path");
  assert.ok(
    src.includes("experimental.chat.system.transform"),
    "injects via system.transform, the documented channel",
  );
  assert.ok(
    src.includes("sessionStartContext"),
    "calls the shared implementation, no baked logic",
  );
  assert.ok(
    !src.includes("spawnSync"),
    "no baked spawn — sessionStartContext owns the guard and the cap",
  );
  assert.ok(!src.includes("capContext"), "no second cap");
  assert.ok(src.includes("output.system"), "pushes into system, never args");
  assert.ok(
    src.includes("sessionID") && src.includes("seen"),
    "dedupes once per session",
  );
  assert.ok(!src.includes("throw"), "must never break a session start");
  console.log(
    "  ✓ session start opencode plugin defers to sessionStartContext",
  );
});
