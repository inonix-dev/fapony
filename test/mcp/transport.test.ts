import { test } from "bun:test";
// test/mcp/transport.test.ts — tests for MCP JSON-RPC dispatch

import assert from "node:assert";
import { dispatch } from "../../src/adapters/mcp/transport.js";

test("testMcpToolsList", () => {
  const result = dispatch("tools/list", {});
  assert.ok(result && typeof result === "object");
  const r = result as {
    tools: {
      name: string;
      inputSchema: { properties: Record<string, unknown> };
    }[];
  };
  assert.deepEqual(
    r.tools.map((t) => t.name),
    ["mem_find", "mem_add", "mem_close"],
  );
  // PLAN-mem-keys chunk 1: mem_add's schema advertises key with the pattern —
  // clients validate before the call, engineAdd still validates after it.
  const memAdd = r.tools.find((t) => t.name === "mem_add");
  const key = memAdd?.inputSchema.properties.key as
    | { pattern?: string }
    | undefined;
  assert.ok(key, "mem_add schema must expose key");
  assert.equal(key?.pattern, "^[a-z0-9-]{3,40}$");
  // PLAN-mem-keys chunk 2: mem_find advertises key WITHOUT a pattern — a
  // wrong-pattern query must reach the server and answer with knownKeys.
  const memFind = r.tools.find((t) => t.name === "mem_find");
  const findKey = memFind?.inputSchema.properties.key as
    | { type?: string; pattern?: string }
    | undefined;
  assert.ok(findKey, "mem_find schema must expose key");
  assert.equal(findKey?.type, "string");
  assert.equal(
    findKey?.pattern,
    undefined,
    "find must not pattern-reject a query",
  );
  console.log(
    "  ✓ mcp tools/list: mem_add carries key pattern, mem_find carries key",
  );
});

test("testMcpInitialize", () => {
  const result = dispatch("initialize", {});
  assert.ok(result && typeof result === "object");
  const r = result as {
    protocolVersion: string;
    serverInfo: { name: string };
    instructions?: string;
  };
  assert.equal(r.protocolVersion, "2025-03-26");
  assert.equal(r.serverInfo.name, "fapony-handcheck");
  // Instructions are the only carrier of the two habits that reaches every
  // client without the user editing their own rules file — if this goes
  // missing, fapony silently stops collecting anything new.
  assert.ok(r.instructions, "initialize must carry server instructions");
  // project_health_context is deliberately absent: the pre-edit habit was cut
  // (rework base rate 1-9%), and this string is paid on every session.
  assert.doesNotMatch(r.instructions ?? "", /project_health_context/);
  assert.match(r.instructions ?? "", /mem add/);
  // PLAN-mem-keys chunk 3: one line names the key habit (write + recall) —
  // rent stays at that single sentence.
  assert.match(r.instructions ?? "", /--key/);
  assert.match(r.instructions ?? "", /mem_find key/);
  assert.doesNotMatch(r.instructions ?? "", /verdict_submit/);
  console.log(
    "  ✓ mcp initialize returns protocol version + instructions (+ --key line)",
  );
});

test("testMcpNotificationsIgnored", () => {
  const result = dispatch("notifications/initialized", {});
  assert.equal(result, null);
  console.log("  ✓ mcp notifications/initialized returns null");
});

test("testMcpUnknownMethod", () => {
  const result = dispatch("foo/bar", {});
  assert.ok(result && typeof result === "object" && "code" in result);
  assert.equal((result as { code: number }).code, -32601);
  console.log("  ✓ mcp unknown method returns error");
});

test("testMcpToolsCallUnknownTool", () => {
  const result = dispatch("tools/call", {
    name: "nonexistent",
    arguments: {},
  });
  assert.ok(result && "isError" in result);
  assert.equal((result as { isError: boolean }).isError, true);
  console.log("  ✓ mcp tools/call unknown tool returns error");
});
