// test/mcp/transport.test.ts — tests for MCP JSON-RPC dispatch

import assert from "node:assert";
import { dispatch } from "../../src/mcp/transport.js";

export function testMcpToolsList(): void {
  const result = dispatch("tools/list", {});
  assert.ok(result && typeof result === "object");
  const r = result as { tools: { name: string }[] };
  assert.deepEqual(
    r.tools.map((t) => t.name),
    [
      "verdict_submit",
      "fapony_stats",
      "fapony_usage",
      "project_health_context",
      "plan_list",
    ],
  );
  console.log("  ✓ mcp tools/list returns 5 tools");
}

export function testMcpInitialize(): void {
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
  assert.match(r.instructions ?? "", /verdict_submit/);
  console.log("  ✓ mcp initialize returns protocol version + instructions");
}

export function testMcpNotificationsIgnored(): void {
  const result = dispatch("notifications/initialized", {});
  assert.equal(result, null);
  console.log("  ✓ mcp notifications/initialized returns null");
}

export function testMcpUnknownMethod(): void {
  const result = dispatch("foo/bar", {});
  assert.ok(result && typeof result === "object" && "code" in result);
  assert.equal((result as { code: number }).code, -32601);
  console.log("  ✓ mcp unknown method returns error");
}

export function testMcpToolsCallUnknownTool(): void {
  const result = dispatch("tools/call", {
    name: "nonexistent",
    arguments: {},
  });
  assert.ok(result && "isError" in result);
  assert.equal((result as { isError: boolean }).isError, true);
  console.log("  ✓ mcp tools/call unknown tool returns error");
}
