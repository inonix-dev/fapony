// src/mcp/transport.ts — JSON-RPC dispatch + stdio entry point

import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { getServerSha } from "./primitives.js";
import {
  TOOLS,
  toolMemAdd,
  toolMemClose,
  toolMemFind,
  toolVerdictSubmit,
} from "./tools/index.js";
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

const SERVER_INSTRUCTIONS = `fapony is a ledger of how work in this project turned out: which model, on which shape of task, produced work that held up. One habit feeds it.

When a unit of work is finished, call verdict_submit to grade it — pass-excellent..pass when it holds, fail when the first attempt was wrong, uncertain when you could not verify it (never guess pass). This is a grade on the work, not a confession: grade routinely, including work that went right the first time, because a model's record is only as good as the number of graded units behind it.

worktree must be the absolute path (git rev-parse --show-toplevel): every query scopes by it, so a bare name or none files the verdict where nothing reads it, and nothing errors to say so. Write the note standalone — what the work was and how it held up — it is read months later with no access to this conversation. Never leave a run non-terminal; an open run absorbs later unrelated verdicts for that worktree.

Skip it and every tool still answers correctly, on a thinner history.`;

// --- Statusline cache ---
//
// Written after every MCP tool call. The Claude Code statusline script reads
// this file (< 1ms, no spawn, no db). Format: single line of text.
// No remaining tool produces bytes_by_tool detail, so every call writes the
// minimal "fapony" marker — cross-client spend lives on the CLI now
// (`fapony usage-scan` + `fapony usage-web`), which the statusline cannot
// spawn (it must stay < 1ms).

const STATUSLINE_PATH = join(homedir(), ".config", "fapony", "statusline");

function writeStatuslineCache(): void {
  try {
    const dir = join(homedir(), ".config", "fapony");
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    writeFileSync(STATUSLINE_PATH, "fapony", "utf-8");
  } catch {
    // Cache write is best-effort — never block MCP on it.
  }
}

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
    case "verdict_submit":
      result = toolVerdictSubmit(args);
      break;
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
  // Write statusline cache after every tool call — best-effort, never blocks.
  writeStatuslineCache();
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
