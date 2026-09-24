// src/mcp/transport.ts — JSON-RPC dispatch + stdio entry point

import { createInterface } from "node:readline";
import { getServerSha } from "./primitives.js";
import { TOOLS, toolMemAdd, toolMemClose, toolMemFind } from "./tools/index.js";
import { errorResult, type ToolResult } from "./types.js";

// --- Server instructions ---
//
// MCP's initialize response carries an `instructions` string that clients
// inject into the model's context. This is the vendor-neutral place for the
// habit fapony depends on — a user should never have to paste rules
// into their own CLAUDE.md (or AGENTS.md, or a hook) to make the tools work,
// and a rule pasted there would only cover one client anyway.
//
// Kept short on purpose: this text is spent on every session of every user.
// Both habits degrade silently — an agent that ignores them still gets
// correct answers from every tool, just a thinner history.

const SERVER_INSTRUCTIONS = `fapony records decisions, bugs, and notes about this project so the next session (or the next agent) knows what happened and what to watch out for.

When you finish a unit of work, record a mem row: fapony mem add <decision|bug|note> "what happened" --files <files> <path/to/PLAN.md>. files[] is required — a row without it is unfindable when you touch that file next session. Name a known problem with --key <domain:sub> and recall every row for it via mem_find key.

worktree must be the absolute path (git rev-parse --show-toplevel): every query scopes by it, so a bare name or none files the row where nothing reads it, and nothing errors to say so. Write the note standalone — it is read months later with no access to this conversation.

Skip it and every tool still answers correctly, on a thinner history.`;

// --- MCP protocol constants ---

const MCP_PROTOCOL_VERSION = "2025-03-26";
const SERVER_NAME = "fapony-handcheck";
const SERVER_VERSION = "0.3.0";

// --- JSON-RPC dispatch ---

export function dispatch(
  method: string,
  params: unknown,
): object | ToolResult | null {
  switch (method) {
    case "initialize":
      return {
        protocolVersion: MCP_PROTOCOL_VERSION,
        capabilities: { tools: {} },
        serverInfo: { name: SERVER_NAME, version: SERVER_VERSION },
        instructions: SERVER_INSTRUCTIONS,
      };
    case "notifications/initialized":
      return null; // no response needed
    case "tools/list":
      return { tools: TOOLS };
    case "tools/call":
      return dispatchToolCall(
        params as { name: string; arguments?: Record<string, unknown> },
      );
    default:
      return {
        code: -32601,
        message: `method not found: ${method}`,
      };
  }
}

function dispatchToolCall(params: {
  name: string;
  arguments?: Record<string, unknown>;
}): ToolResult {
  const args = params.arguments ?? {};
  let result: ToolResult;
  switch (params.name) {
    case "mem_find":
      result = toolMemFind(args);
      break;
    case "mem_add":
      result = toolMemAdd(args);
      break;
    case "mem_close":
      result = toolMemClose(args);
      break;
    default:
      return errorResult(`unknown tool: ${params.name}`);
  }
  return result;
}

// --- Entry point ---

export function cmdMcp(): void {
  getServerSha(); // cache while the process is still fresh, not on first report call
  const rl = createInterface({ input: process.stdin });

  rl.on("line", (line) => {
    const trimmed = line.trim();
    if (!trimmed) return;

    let msg: { id?: number; method: string; params?: unknown };
    try {
      msg = JSON.parse(trimmed);
    } catch {
      // Invalid JSON — send error
      const resp = {
        jsonrpc: "2.0",
        id: null,
        error: { code: -32700, message: "Parse error" },
      };
      process.stdout.write(`${JSON.stringify(resp)}\n`);
      return;
    }

    const result = dispatch(msg.method, msg.params ?? {});

    // notifications don't get a response
    if (result === null) return;

    const resp: Record<string, unknown> = {
      jsonrpc: "2.0",
      id: msg.id ?? null,
    };

    if (
      result &&
      typeof result === "object" &&
      "content" in result &&
      "isError" in result
    ) {
      // Tool result
      resp.result = result;
    } else if (
      result &&
      typeof result === "object" &&
      "code" in result &&
      "message" in result
    ) {
      // Error response
      resp.error = result;
    } else {
      // Normal result
      resp.result = result;
    }

    process.stdout.write(`${JSON.stringify(resp)}\n`);
  });

  rl.on("close", () => {
    process.exit(0);
  });
}
