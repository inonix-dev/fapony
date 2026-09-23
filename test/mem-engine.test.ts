import { test } from "bun:test";
// test/mem-engine.test.ts — shared add/close engine (PLAN-unify-mem-engine
// chunk 1): caps throw a typed CapError with the bare message (no MEM_FORCE
// hint — wrappers add their own wording), and MEM_FORCE bypasses the caps.

import assert from "node:assert";
import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readMemLog } from "../src/core/mem-log.js";
import {
  CAP_NEXT,
  CapError,
  CLI_FIND_EXCLUDE,
  engineAdd,
  engineClose,
  engineFind,
} from "../src/mem/engine.js";
import { initStore } from "../src/mem/store.js";
import { withTempRepo } from "./helpers.js";

const FAPONY = join(import.meta.dir, "..", "fapony.ts");

test("testEngineCapThrowsBareCapError", () => {
  const dir = mkdtempSync(join(tmpdir(), "fapony-engine-"));
  try {
    const memDir = join(dir, ".fapony", ".memory");
    mkdirSync(memDir, { recursive: true });
    const rows = Array.from({ length: CAP_NEXT }, (_, i) =>
      JSON.stringify({
        ts: "2026-01-01T00:00:00.000Z",
        agent: "t",
        id: `n${i}`,
        kind: "next",
        text: `open ${i}`,
        files: ["a.ts"],
      }),
    );
    writeFileSync(join(memDir, "log.jsonl"), `${rows.join("\n")}\n`);
    initStore(dir);

    // cap full → typed error, bare message (CLI appends the hint itself)
    assert.throws(
      () => engineAdd({ kind: "next", text: "one more", files: ["b.ts"] }),
      (e: unknown) => {
        assert.ok(e instanceof CapError);
        assert.equal((e as CapError).cap, "next");
        assert.match(
          (e as Error).message,
          /open next 15\/15 is full — close an old one first/,
        );
        assert.doesNotMatch((e as Error).message, /MEM_FORCE/);
        return true;
      },
    );

    // MEM_FORCE bypasses — both wrappers rely on this
    process.env.MEM_FORCE = "1";
    try {
      const added = engineAdd({
        kind: "next",
        text: "forced",
        files: ["b.ts"],
      });
      assert.ok(added.id);
    } finally {
      delete process.env.MEM_FORCE;
    }

    // close-text rule: an empty tombstone errors (CLI accepted it before chunk 1)
    assert.throws(
      () => engineClose({ id: "n0", text: "  " }),
      /text is required/,
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  console.log("  ✓ engine caps throw bare CapError; empty close text rejected");
});

test("testEngineFindExcludeKindAndIncludeWins", () => {
  // PLAN-unify-mem-engine chunk 2 §4.2: the engine takes excludeKind, each
  // side passes its own default — MCP passes none (contract: every kind, no
  // default filter), CLI passes the bookkeeping list. An explicit kind
  // include wins over the exclude (so `find --kind close` can see closes).
  const rows = [
    { ts: "2026-01-01T00:00:00.000Z", kind: "decision", text: "a" },
    { ts: "2026-01-02T00:00:00.000Z", kind: "close", text: "b", ref: "x" },
    { ts: "2026-01-03T00:00:00.000Z", kind: "claim", ref: "y" },
    { ts: "2026-01-04T00:00:00.000Z", kind: "bug", text: "c" },
  ];
  const cli = engineFind(rows, { excludeKind: CLI_FIND_EXCLUDE });
  assert.equal(
    cli.total,
    2,
    "CLI default hides close/claim (synced/release too)",
  );
  assert.ok(cli.rows.every((r) => r.kind === "decision" || r.kind === "bug"));

  const mcp = engineFind(rows, {});
  assert.equal(mcp.total, 4, "MCP default: no filter");

  const explicit = engineFind(rows, {
    kind: ["close"],
    excludeKind: CLI_FIND_EXCLUDE,
  });
  assert.equal(explicit.total, 1, "explicit kind wins over the exclude");
  assert.equal(explicit.rows[0].kind, "close");
  console.log("  ✓ engineFind kind default per side; explicit kind wins");
});

test("testEngineFindTextFilesSinceLimit", () => {
  const rows = [
    {
      ts: "2026-01-01T00:00:00.000Z",
      kind: "decision",
      text: "wrapper lives in service",
      files: ["src/deep/zone/handler.ts"],
    },
    {
      ts: "2026-06-01T00:00:00.000Z",
      kind: "bug",
      text: "unrelated",
      spec: "apps/vela/SPEC-x.md",
    },
    { ts: "2026-06-02T00:00:00.000Z", kind: "note", text: "newest row" },
  ];
  // text matches spec too (CLI HELP promises text/spec/ref)
  assert.equal(engineFind(rows, { text: "spec-x" }).total, 1);
  // stored files[] first, suffix still matches
  assert.equal(engineFind(rows, { files: ["handler.ts"] }).total, 1);
  assert.equal(engineFind(rows, { files: ["src/other.ts"] }).total, 0);
  // since is inclusive
  assert.equal(
    engineFind(rows, { sinceIso: "2026-06-01T00:00:00.000Z" }).total,
    2,
  );
  // total counts before limit; order is newest first
  const lim = engineFind(rows, { limit: 2 });
  assert.equal(lim.total, 3);
  assert.equal(lim.rows.length, 2);
  assert.equal(lim.rows[0].ts, "2026-06-02T00:00:00.000Z");
  console.log("  ✓ engineFind text/files/since/limit");
});

test("testEngineFindOpenDropsClosedAndBookkeeping", () => {
  // PLAN-unify-mem-engine chunk 4: open:true = unresolved work only — the
  // answer to "what bugs remain" without correlating close tombstones by hand.
  const rows = [
    { ts: "2026-01-01T00:00:00.000Z", kind: "bug", text: "open bug", id: "b1" },
    {
      ts: "2026-01-02T00:00:00.000Z",
      kind: "bug",
      text: "fixed bug",
      id: "b2",
    },
    { ts: "2026-01-03T00:00:00.000Z", kind: "close", text: "fixed", ref: "b2" },
    { ts: "2026-01-04T00:00:00.000Z", kind: "note", text: "context", id: "n1" },
    { ts: "2026-01-05T00:00:00.000Z", kind: "synced", text: "s" },
    { ts: "2026-01-06T00:00:00.000Z", kind: "claim", text: "c", ref: "b1" },
  ];
  const all = engineFind(rows, {});
  assert.equal(all.total, 6, "default false: recall shows closed rows too");
  const open = engineFind(rows, { open: true });
  assert.equal(open.total, 2, "drops the closed bug + close/claim/synced");
  assert.ok(open.rows.every((r) => r.text !== "fixed bug"));
  const openBugs = engineFind(rows, { open: true, kind: ["bug"] });
  assert.equal(openBugs.total, 1);
  assert.equal(openBugs.rows[0].text, "open bug");
  console.log("  ✓ engineFind open:true drops closed + bookkeeping");
});

// PLAN-mem-keys chunk 1 — key on the write path: optional, validated against
// KEY_RE when present, every new row stamped v:2, v:1 legacy rows unchanged.
test("testEngineAddKeyValidationAndV2", () => {
  const dir = mkdtempSync(join(tmpdir(), "fapony-engine-key-"));
  try {
    const memDir = join(dir, ".fapony", ".memory");
    mkdirSync(memDir, { recursive: true });
    // v:1 legacy row — no key, no v — must keep reading as-is
    writeFileSync(
      join(memDir, "log.jsonl"),
      `${JSON.stringify({
        ts: "2026-01-01T00:00:00.000Z",
        agent: "old",
        kind: "note",
        text: "legacy v1 row",
        files: ["a.ts"],
      })}\n`,
    );
    initStore(dir);

    // valid key → written with key + v:2
    const keyed = engineAdd({
      kind: "note",
      text: "with key",
      files: ["b.ts"],
      key: "fix-stop-dedupe",
    });
    assert.equal(keyed.key, "fix-stop-dedupe");

    // no key → still v:2, key field absent (JSON.stringify drops undefined)
    const bare = engineAdd({ kind: "note", text: "no key", files: ["c.ts"] });
    assert.equal(bare.key, undefined);

    // pattern violations reject loudly with a usable example — never silent.
    // ("fix" in SPEC's fail example is a slip — it is 3 chars and valid;
    //  the intent is < 3, so "fx" is what {3,40} actually rejects.)
    for (const bad of ["Fix-Stop", "fx", "has_underscore", "a".repeat(41)]) {
      assert.throws(
        () => engineAdd({ kind: "note", text: "x", files: ["d.ts"], key: bad }),
        (e: unknown) => {
          const m = (e as Error).message;
          assert.match(m, /key must match \[a-z0-9-\]\{3,40\}/);
          assert.ok(
            m.includes("fix-stop-dedupe"),
            "reject message carries a working example",
          );
          return true;
        },
        `key "${bad}" must be rejected`,
      );
    }

    // read back: keyed row has key+v:2, keyless new row has v:2, v:1 intact
    const rows = readMemLog(dir).rows;
    const legacy = rows.find((r) => r.text === "legacy v1 row");
    assert.ok(legacy, "v:1 row still readable");
    assert.equal(legacy.key, undefined);
    assert.equal(legacy.v, undefined);
    assert.deepEqual(legacy.files, ["a.ts"], "v:1 fields read unchanged");
    const readKeyed = rows.find((r) => r.text === "with key");
    assert.equal(readKeyed?.key, "fix-stop-dedupe");
    assert.equal(readKeyed?.v, 2);
    const readBare = rows.find((r) => r.text === "no key");
    assert.equal(readBare?.v, 2);
    assert.equal(readBare?.key, undefined);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  console.log("  ✓ engineAdd validates key, stamps v:2, keeps v:1 readable");
});

// The CLI argv layer must extract --key without eating a text word that
// happens to equal the key value, and must surface the engine's rejection
// as exit 1 (rule 9: a wrong key never writes silently).
test("testMemAddCliKeyFlagEndToEnd", () => {
  withTempRepo((dir) => {
    const add = (...extra: string[]) =>
      Bun.spawnSync(["bun", FAPONY, "mem", "add", "note", ...extra], {
        cwd: dir,
        stdout: "pipe",
        stderr: "pipe",
      });

    // key value also appears inside the text — position-based strip keeps it
    const ok = add(
      "same word fix-stop-dedupe in text too",
      "--files",
      "a.ts",
      "--key",
      "fix-stop-dedupe",
    );
    assert.equal(ok.exitCode, 0, ok.stderr.toString());
    const memDir = join(dir, ".fapony", ".memory");
    const logFile = readdirSync(memDir)
      .filter((f) => f.endsWith(".jsonl"))
      .map((f) => join(memDir, f))
      .map((p) => readFileSync(p, "utf8"))
      .join("\n");
    const row = logFile
      .split("\n")
      .filter(Boolean)
      .map((l) => JSON.parse(l) as { text?: string; key?: string; v?: number })
      .find((r) => r.text?.startsWith("same word"));
    assert.ok(row, "row written");
    assert.equal(row.key, "fix-stop-dedupe");
    assert.equal(row.v, 2);
    assert.ok(
      row.text?.includes("same word fix-stop-dedupe in text too"),
      "text keeps every word — only the flag tokens are stripped",
    );

    // no key → still a v:2 row, no key field
    const noKey = add("plain row", "--files", "b.ts");
    assert.equal(noKey.exitCode, 0, noKey.stderr.toString());

    // bad pattern → exit 1 with the example-bearing message, row not written
    const before = readdirSync(join(dir, ".fapony", ".memory")).length;
    const bad = add("bad key row", "--files", "c.ts", "--key", "Fix-Stop");
    assert.equal(bad.exitCode, 1, "pattern violation must exit 1");
    assert.match(bad.stderr.toString(), /key must match/);
    assert.match(bad.stderr.toString(), /fix-stop-dedupe/);

    // --key without a value → usage error before any write
    const missing = add("missing key value", "--files", "d.ts", "--key");
    assert.equal(missing.exitCode, 1);
    assert.match(missing.stderr.toString(), /--key needs a value/);
    assert.equal(
      readdirSync(join(dir, ".fapony", ".memory")).length,
      before,
      "failed adds write nothing",
    );
  });
  console.log("  ✓ CLI --key writes v:2, rejects bad/missing key with exit 1");
});

// PLAN-mem-keys chunk 2 — key on the read path: exact match first (never a
// substring fallback), close rows derive their key from the ref'd work row
// at read time, and a pure key miss answers with knownKeys (SPEC fail
// example: Fix-Stop → the list) instead of a silent empty.
test("testEngineFindKeyExactAndKnownKeys", () => {
  const rows = [
    {
      ts: "2026-01-01T00:00:00.000Z",
      kind: "bug",
      text: "dedupe stop hook",
      id: "b1",
      key: "fix-stop-dedupe",
      files: ["a.ts"],
    },
    {
      ts: "2026-01-02T00:00:00.000Z",
      kind: "note",
      text: "same problem follow-up",
      id: "n1",
      key: "fix-stop-dedupe",
      files: ["b.ts"],
    },
    {
      ts: "2026-01-03T00:00:00.000Z",
      kind: "note",
      text: "other problem",
      id: "n2",
      key: "unify-mem-engine",
    },
    {
      ts: "2026-01-04T00:00:00.000Z",
      kind: "note",
      text: "legacy v1 row",
      id: "v1",
      files: ["a.ts"],
    },
    {
      ts: "2026-01-05T00:00:00.000Z",
      kind: "close",
      text: "fixed in abc",
      ref: "b1",
    },
  ];

  // exact key: two keyed rows + the close deriving it via ref, no keyless
  // leak, hit carries no knownKeys
  const byKey = engineFind(rows, { key: "fix-stop-dedupe" });
  assert.equal(byKey.total, 3, "two keyed rows + the close deriving via ref");
  assert.ok(byKey.rows.some((r) => r.text === "dedupe stop hook"));
  assert.ok(byKey.rows.some((r) => r.text === "same problem follow-up"));
  assert.ok(byKey.rows.some((r) => r.kind === "close"));
  assert.ok(byKey.rows.every((r) => r.text !== "other problem"));
  assert.ok(byKey.rows.every((r) => r.text !== "legacy v1 row"));
  assert.equal(byKey.knownKeys, undefined, "hit carries no knownKeys");

  // v:1 row falls out of the key query but stays findable via files/text —
  // the fallback path never involved key, so nothing about it changed
  const legacy = engineFind(rows, { files: ["a.ts"] });
  assert.equal(legacy.total, 2, "v:1 still reachable via files fallback");
  assert.ok(legacy.rows.some((r) => !r.key));

  // AND with other filters
  const anded = engineFind(rows, { key: "fix-stop-dedupe", files: ["b.ts"] });
  assert.equal(anded.total, 1);
  assert.equal(anded.rows[0].text, "same problem follow-up");

  // close tombstone matches through the ref'd row's key (derive at read time)
  const closes = engineFind(rows, { key: "fix-stop-dedupe", kind: ["close"] });
  assert.equal(closes.total, 1, "close derives key from ref");
  assert.equal(closes.rows[0].kind, "close");

  // pure key miss → knownKeys (distinct, sorted), never silent
  const miss = engineFind(rows, { key: "Fix-Stop" });
  assert.equal(miss.total, 0);
  assert.deepEqual(miss.knownKeys, ["fix-stop-dedupe", "unify-mem-engine"]);

  // key exists but another filter empties it → NOT a key miss, no knownKeys
  const filteredOut = engineFind(rows, {
    key: "unify-mem-engine",
    kind: ["bug"],
  });
  assert.equal(filteredOut.total, 0);
  assert.equal(filteredOut.knownKeys, undefined);

  // no key arg → result shape unchanged (no knownKeys field)
  const plain = engineFind(rows, {});
  assert.equal(plain.total, 5);
  assert.equal(plain.knownKeys, undefined);
  console.log(
    "  ✓ engineFind key exact-match, close derive, knownKeys on miss",
  );
});

// The find surface must answer a wrong key with the list of real keys —
// rule 9: a silent empty would read as "this problem never happened".
test("testMemFindCliKeyFlagEndToEnd", () => {
  withTempRepo((dir) => {
    const run = (...args: string[]) =>
      Bun.spawnSync(["bun", FAPONY, "mem", ...args], {
        cwd: dir,
        stdout: "pipe",
        stderr: "pipe",
      });

    const add = run(
      "add",
      "note",
      "stop hook dedupes now",
      "--files",
      "src/hook.ts",
      "--key",
      "fix-stop-dedupe",
    );
    assert.equal(add.exitCode, 0, add.stderr.toString());
    const plain = run("add", "note", "legacy row text", "--files", "src/a.ts");
    assert.equal(plain.exitCode, 0, plain.stderr.toString());

    // hit: only the keyed row, and no miss hint pollutes the output
    const hit = run("find", "--key", "fix-stop-dedupe");
    assert.equal(hit.exitCode, 0, hit.stderr.toString());
    const hitOut = hit.stdout.toString();
    assert.ok(hitOut.includes("stop hook dedupes now"), hitOut);
    assert.ok(!hitOut.includes("legacy row text"), hitOut);
    assert.ok(!hitOut.includes("no key"), "hit must not print the miss hint");

    // pure key miss (bad pattern never stored) → known-keys list, exit 0
    const miss = run("find", "--key", "Fix-Stop");
    assert.equal(miss.exitCode, 0, "find never rejects a key pattern");
    assert.match(
      miss.stdout.toString(),
      /no key Fix-Stop; known keys: fix-stop-dedupe/,
    );

    // --key without a value → usage error
    const missing = run("find", "--key");
    assert.equal(missing.exitCode, 1);
    assert.match(missing.stderr.toString(), /--key needs a value/);
  });
  console.log(
    "  ✓ CLI find --key hits, misses with known keys, rejects no value",
  );
});
