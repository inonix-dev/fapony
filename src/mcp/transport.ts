// src/mcp/transport.ts — JSON-RPC dispatch + stdio entry point

import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { mergeBytesByTool, type UsageDetail } from "../session/index.js";
import { getServerSha } from "./primitives.js";
import {
  TOOLS,
  toolFaponyStats,
  toolMemFind,
  toolPassiveUsage,
  toolPlanList,
  toolProjectHealthContext,
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
// Only fapony_usage with detail:true produces meaningful data (bytes_by_tool,
// aggregated across all clients — the bytes live on the claude_code
// sub-object, never top-level); other tools write a minimal "fapony" marker.

const STATUSLINE_PATH = join(homedir(), ".config", "fapony", "statusline");

function writeStatuslineCache(toolResult: ToolResult): void {
  try {
    // Extract bytes_by_tool from fapony_usage detail JSON response.
    let line = "fapony";
    if (
      toolResult &&
      typeof toolResult === "object" &&
      "content" in toolResult &&
      Array.isArray(toolResult.content)
    ) {
      for (const c of toolResult.content) {
        if (
          c &&
          typeof c === "object" &&
          c.type === "text" &&
          typeof c.text === "string"
        ) {
          // Try to extract bytes_by_tool from JSON text response.
          // Aggregated across all clients: the bytes live on the Claude Code
          // sub-object (claude_code.detail), never on the top-level detail,
          // so reading top-level alone would always miss.
          try {
            const parsed = JSON.parse(c.text) as {
              detail?: UsageDetail | null;
              zcode?: { detail?: UsageDetail | null } | null;
              claude_code?: { detail?: UsageDetail | null } | null;
              codex?: { detail?: UsageDetail | null } | null;
            };
            const bbt = mergeBytesByTool(
              parsed?.detail,
              parsed?.zcode?.detail,
              parsed?.claude_code?.detail,
              parsed?.codex?.detail,
            );
            const entries = Object.entries(bbt).sort((a, b) => b[1] - a[1]);
            const total = entries.reduce((s, e) => s + e[1], 0);
            if (total > 0) {
              // Format: "84.2k" for total, or "Read 42k · Grep 31k" for top tools.
              const fmt = (n: number) =>
                n >= 1024 ? `${(n / 1024).toFixed(1)}k` : `${Math.round(n)}`;
              if (entries.length <= 3) {
                line = `fapony ${entries.map((e) => `${e[0]} ${fmt(e[1])}`).join(" · ")}`;
              } else {
                line = `fapony ${fmt(total)}`;
              }
            }
          } catch {
            // Not JSON — that's fine, use default "fapony" marker.
          }
          break;
        }
      }
    }
    const dir = join(homedir(), ".config", "fapony");
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    writeFileSync(STATUSLINE_PATH, line, "utf-8");
  } catch {
    // Cache write is best-effort — never block MCP on it.
  }
}

// --- MCP protocol constants ---

const MCP_PROTOCOL_VERSION = "2025-03-26";
const SERVER_NAME = "fapony-handcheck";
const SERVER_VERSION = "0.1.3";

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
    case "fapony_stats":
      result = toolFaponyStats(args);
      break;
    case "fapony_usage":
      result = toolPassiveUsage(args);
      break;
    case "project_health_context":
      result = toolProjectHealthContext(args);
      break;
    case "plan_list":
      result = toolPlanList(args);
      break;
    case "mem_find":
      result = toolMemFind(args);
      break;
    default:
      return errorResult(`unknown tool: ${params.name}`);
  }
  // Write statusline cache after every tool call — best-effort, never blocks.
  writeStatuslineCache(result);
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
