import { test } from "bun:test";
// test/mem-key-registry.test.ts — PLAN-mem-core chunk 4 (domain key registry).
//
// Done criteria: `mem_add key:"nope:x"` in a repo with a registry rejects
// with `known domains: …`; `mem_find key:"auth"` catches every `auth:*`.

import assert from "node:assert";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { memAdd, toolMemAdd } from "../src/adapters/mcp/tools/mem.js";
import { cmdKickoff } from "../src/mem/commands/read.js";
import { engineAdd, engineFind } from "../src/mem/engine.js";
import {
  checkKeyDomain,
  keyMatchesQuery,
  loadKeyRegistry,
  resolveKeysPath,
  splitKey,
} from "../src/mem/key-registry.js";
import { initStore } from "../src/mem/store.js";
import { captureLogs, withTempRepo } from "./helpers.js";

const FAPONY = join(import.meta.dir, "..", "fapony.ts");

const seedKeys = (dir: string, obj: unknown) => {
  mkdirSync(join(dir, ".fapony"), { recursive: true });
  writeFileSync(join(dir, ".fapony", "keys.json"), JSON.stringify(obj));
};

test("testKeyRegistryLoadShapes", () => {
  const dir = mkdtempSync(join(tmpdir(), "fapony-keys-"));
  try {
    // no file = empty + no error (same contract as conventions.json)
    assert.deepEqual(loadKeyRegistry(dir), {
      path: null,
      domains: [],
      warnings: [],
    });
    assert.equal(resolveKeysPath(dir), null);

    // object form, sorted + deduped
    seedKeys(dir, { domains: ["hook", "auth", "auth"] });
    let reg = loadKeyRegistry(dir);
    assert.deepEqual(reg.domains, ["auth", "hook"]);
    assert.deepEqual(reg.warnings, []);
    assert.ok(reg.path?.endsWith(".fapony/keys.json"), reg.path ?? "(null)");

    // bare array form reads the same
    seedKeys(dir, ["auth"]);
    reg = loadKeyRegistry(dir);
    assert.deepEqual(reg.domains, ["auth"]);

    // non-string / off-pattern entries drop with one warning, never a throw
    seedKeys(dir, { domains: ["auth", "UI", 7, "ab", null] });
    reg = loadKeyRegistry(dir);
    assert.deepEqual(reg.domains, ["auth"]);
    assert.equal(reg.warnings.length, 1);

    // invalid JSON = warnings + empty, never a throw (add stays unblocked)
    writeFileSync(join(dir, ".fapony", "keys.json"), "{nope");
    reg = loadKeyRegistry(dir);
    assert.deepEqual(reg.domains, []);
    assert.equal(reg.warnings.length, 1);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  console.log(
    "  ✓ keys.json loads (object/array), drops bad entries, never throws",
  );
});

test("testSplitKeyAndPrefixMatch", () => {
  assert.deepEqual(splitKey("auth:login"), { domain: "auth", sub: "login" });
  assert.equal(splitKey("fix-stop-dedupe"), null);
  // bare domain doubles as a prefix; colon form is exact
  assert.ok(keyMatchesQuery("auth:login", "auth"));
  assert.ok(keyMatchesQuery("auth:login", "auth:login"));
  assert.ok(!keyMatchesQuery("auth:login", "auth:logout"));
  assert.ok(!keyMatchesQuery("auth:login", "au"));
  assert.ok(!keyMatchesQuery(undefined, "auth"));
  // exact bare key still matches itself, never its namespaced cousins
  assert.ok(keyMatchesQuery("auth", "auth"));
  assert.ok(!keyMatchesQuery("auth:login", "auth:login:extra"));
  console.log("  ✓ splitKey + domain-prefix matching");
});

test("testEngineAddDomainGate", () => {
  const dir = mkdtempSync(join(tmpdir(), "fapony-keys-engine-"));
  try {
    mkdirSync(join(dir, ".fapony", ".memory"), { recursive: true });
    initStore(dir);

    // no registry (null) = free-form keys, colon included — old behavior
    const free = engineAdd({
      kind: "note",
      text: "free key",
      files: ["a.ts"],
      key: "anything:goes",
    });
    assert.equal(free.key, "anything:goes");

    // registry present: listed domain + bare legacy keys pass
    const ok = engineAdd({
      kind: "note",
      text: "namespaced",
      files: ["b.ts"],
      key: "auth:login",
      knownDomains: ["auth", "hook"],
    });
    assert.equal(ok.key, "auth:login");
    const bare = engineAdd({
      kind: "note",
      text: "bare stays",
      files: ["c.ts"],
      key: "fix-stop-dedupe",
      knownDomains: ["auth"],
    });
    assert.equal(bare.key, "fix-stop-dedupe");

    // unknown domain rejects with the usable list (rule 9: reject + enumerate)
    assert.throws(
      () =>
        engineAdd({
          kind: "note",
          text: "x",
          files: ["d.ts"],
          key: "nope:x",
          knownDomains: ["auth", "hook"],
        }),
      (e: unknown) => {
        const m = (e as Error).message;
        assert.match(m, /unknown key domain "nope"/);
        assert.match(m, /known domains: auth, hook/);
        return true;
      },
    );

    // registry present but empty = every domain unknown, said plainly
    assert.throws(
      () =>
        engineAdd({
          kind: "note",
          text: "x",
          files: ["e.ts"],
          key: "auth:login",
          knownDomains: [],
        }),
      /known domains: \(none yet\)/,
    );

    // shape violations still fail at the pattern, before the registry
    for (const bad of ["Auth:login", "ab:x", "a:b:c", "auth:UP"]) {
      assert.throws(
        () =>
          engineAdd({
            kind: "note",
            text: "x",
            files: ["f.ts"],
            key: bad,
            knownDomains: ["auth"],
          }),
        /key must match/,
        `key "${bad}" must fail the pattern`,
      );
    }

    // checkKeyDomain unit edges: null = no registry = never reject
    assert.equal(checkKeyDomain("nope:x", null), null);
    assert.equal(checkKeyDomain("nope:x", undefined), null);
    assert.equal(checkKeyDomain("bare-key", ["auth"]), null);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  console.log("  ✓ engineAdd gates the domain half, leaves bare keys alone");
});

test("testEngineFindDomainPrefix", () => {
  const rows = [
    {
      ts: "2026-01-01T00:00:00.000Z",
      kind: "bug",
      text: "login broken",
      id: "b1",
      key: "auth:login",
    },
    {
      ts: "2026-01-02T00:00:00.000Z",
      kind: "note",
      text: "logout follow-up",
      id: "n1",
      key: "auth:logout",
    },
    {
      ts: "2026-01-03T00:00:00.000Z",
      kind: "note",
      text: "hook work",
      id: "n2",
      key: "hook:run",
    },
    {
      ts: "2026-01-04T00:00:00.000Z",
      kind: "close",
      text: "fixed in abc",
      ref: "b1",
    },
  ];

  // done criterion: key:"auth" catches every auth:* (+ the close deriving one)
  const byDomain = engineFind(rows, { key: "auth" });
  assert.equal(byDomain.total, 3);
  assert.ok(byDomain.rows.some((r) => r.text === "login broken"));
  assert.ok(byDomain.rows.some((r) => r.text === "logout follow-up"));
  assert.ok(byDomain.rows.some((r) => r.kind === "close"));
  assert.equal(byDomain.knownKeys, undefined, "hit carries no knownKeys");

  // colon form stays exact — logout never leaks into a login query
  const exact = engineFind(rows, { key: "auth:login" });
  assert.equal(exact.total, 2, "login row + its close");
  assert.ok(exact.rows.every((r) => r.text !== "logout follow-up"));

  // other domains unaffected
  assert.equal(engineFind(rows, { key: "hook" }).total, 1);

  // pure miss still answers with the full key list
  const miss = engineFind(rows, { key: "zzz" });
  assert.equal(miss.total, 0);
  assert.deepEqual(miss.knownKeys, ["auth:login", "auth:logout", "hook:run"]);
  console.log("  ✓ find key: bare domain is a prefix, colon form is exact");
});

test("testMemAddCliAndMcpRejectUnknownDomain", () => {
  withTempRepo((dir) => {
    seedKeys(dir, { domains: ["auth"] });
    const run = (...extra: string[]) =>
      Bun.spawnSync(["bun", FAPONY, "mem", "add", ...extra], {
        cwd: dir,
        stdout: "pipe",
        stderr: "pipe",
      });

    // done criterion: mem_add key:"nope:x" rejects with the known list
    const bad = run(
      "note",
      "bad domain row",
      "--files",
      "a.ts",
      "--key",
      "nope:x",
    );
    assert.equal(bad.exitCode, 1, "unknown domain must exit 1");
    assert.match(bad.stderr.toString(), /unknown key domain "nope"/);
    assert.match(bad.stderr.toString(), /known domains: auth/);

    // listed domain + bare legacy key both write
    const ok = run(
      "note",
      "good domain row",
      "--files",
      "b.ts",
      "--key",
      "auth:login",
    );
    assert.equal(ok.exitCode, 0, ok.stderr.toString());
    const bare = run(
      "note",
      "bare row",
      "--files",
      "c.ts",
      "--key",
      "fix-stop-dedupe",
    );
    assert.equal(bare.exitCode, 0, bare.stderr.toString());

    // CLI find: bare domain is a prefix
    const found = Bun.spawnSync(
      ["bun", FAPONY, "mem", "find", "--key", "auth"],
      {
        cwd: dir,
        stdout: "pipe",
        stderr: "pipe",
      },
    );
    assert.equal(found.exitCode, 0, found.stderr.toString());
    assert.ok(found.stdout.toString().includes("good domain row"));
    assert.ok(!found.stdout.toString().includes("bare row"));

    // MCP surface: same gate, JSON error shape (no throw out of the tool)
    const mcpBad = toolMemAdd({
      worktree: dir,
      kind: "note",
      text: "mcp bad domain",
      files: ["d.ts"],
      key: "nope:y",
    });
    assert.equal(mcpBad.isError, true);
    assert.match(mcpBad.content[0].text, /unknown key domain/);
    assert.match(mcpBad.content[0].text, /known domains: auth/);
    const mcpOk = memAdd({
      worktree: dir,
      kind: "note",
      text: "mcp good domain",
      files: ["e.ts"],
      key: "auth:token",
    });
    assert.equal(mcpOk.key, "auth:token");
  });
  console.log("  ✓ CLI + MCP reject unknown domains, accept listed + bare");
});

test("testKickoffShowsKeyDomains", () => {
  withTempRepo((dir) => {
    const memDir = join(dir, ".fapony", ".memory");
    mkdirSync(memDir, { recursive: true });
    writeFileSync(
      join(memDir, "log.jsonl"),
      `${JSON.stringify({
        ts: "2026-01-01T00:00:00.000Z",
        agent: "t",
        id: "n1",
        kind: "note",
        text: "hello",
        files: ["a.ts"],
      })}\n`,
    );
    initStore(dir);
    const prev = process.cwd();
    process.chdir(dir);
    try {
      // no registry = silent (no domains line)
      const silent = captureLogs(() => cmdKickoff([]));
      assert.ok(
        !silent.includes("key domains:"),
        `must stay silent:\n${silent}`,
      );

      // registry = exactly one domains line under the header
      seedKeys(dir, { domains: ["auth", "hook"] });
      const shown = captureLogs(() => cmdKickoff([]));
      assert.match(shown, /^key domains: auth, hook — use --key domain:sub$/m);
    } finally {
      process.chdir(prev);
    }
  });
  console.log(
    "  ✓ kickoff prints one domains line with a registry, silent without",
  );
});
