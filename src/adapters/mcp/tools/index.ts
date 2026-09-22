// src/mcp/tools/index.ts — barrel + TOOLS array
//
// Every schema here is paid as input tokens in *every* session of *every*
// client that connects, whether or not the tool is called. Adding one is
// buying attention with a standing charge; earning it back means the tool
// saves more than it costs (see CLAUDE.md "จ่าย token อย่างฉลาด"). Keep
// descriptions imperative — say what to send, not why it matters.

export { toolMemAdd, toolMemClose, toolMemFind } from "./mem.js";

// --- Tool definitions ---

export const TOOLS = [
  {
    name: "mem_find",
    description:
      "Search the project's mem log (.fapony/.memory/log*.jsonl — decisions, " +
      "bugs, notes, and bookkeeping kinds alike; NO default kind filter). " +
      "Read-only. Answer 'what was ever decided about this file?' in one call " +
      "BEFORE editing: pass files[] (repo-relative). Matches the row's stored " +
      "files[], falling back to a substring of text/spec/ref for rows written " +
      "without it — a row that names the file nowhere cannot be found. " +
      "memDir shows which log dir was resolved (walked up from the given " +
      "worktree — in a monorepo pass the app directory to read its log). " +
      "Returns {rows, total, filesFound, " +
      "skipped, memDir}: memDir:null = no mem at all, not 'nothing matched'.",
    inputSchema: {
      type: "object" as const,
      properties: {
        worktree: {
          type: "string",
          description:
            "Absolute path (git rev-parse --show-toplevel) — required; " +
            "scope of the mem log to read",
        },
        files: {
          type: "array",
          items: { type: "string" },
          description:
            "Repo-relative paths — matched against the row's files[], else its text",
        },
        text: {
          type: "string",
          description: "Substring, case-insensitive",
        },
        kind: {
          type: "array",
          items: { type: "string" },
          description:
            "Filter by kind (decision/note/bug/close/…). Omit = every kind — " +
            "no default filter",
        },
        since: {
          type: "string",
          description: "ISO date — only rows at or after this time",
        },
        limit: {
          type: "number",
          description:
            "Max rows returned (default 20) — total still counts all matches",
        },
      },
      required: ["worktree"],
    },
  },
  {
    name: "mem_add",
    description:
      "Append a mem row (decision/bug/note/next/hold) with files[]. files is " +
      "required — a row that does not name the file is unfindable when you " +
      "touch that file. Returns the row's id, kind, files, and timestamp.",
    inputSchema: {
      type: "object" as const,
      properties: {
        worktree: {
          type: "string",
          description:
            "Absolute path (git rev-parse --show-toplevel) — required",
        },
        kind: {
          type: "string",
          enum: ["next", "bug", "decision", "note", "hold"],
          description:
            "Row kind: decision=locked choice, bug=broken thing, note=state " +
            "next session needs, next=pending work, hold=blocked on spec",
        },
        text: {
          type: "string",
          description:
            "Standalone text — read months later, no conversation context",
        },
        files: {
          type: "array",
          items: { type: "string" },
          description:
            "Repo-relative paths this row is about — required, non-empty",
        },
        spec: {
          type: "string",
          description: "Optional spec/plan .md path",
        },
      },
      required: ["worktree", "kind", "text", "files"],
    },
  },
  {
    name: "mem_close",
    description:
      "Close a mem row by id with a tombstone message (what was done). " +
      "The write half of closing what mem_find shows as open — id must exist. " +
      "Returns the ref and timestamp.",
    inputSchema: {
      type: "object" as const,
      properties: {
        worktree: {
          type: "string",
          description:
            "Absolute path (git rev-parse --show-toplevel) — required",
        },
        id: {
          type: "string",
          description: "The row id to close",
        },
        text: {
          type: "string",
          description: "Tombstone message — what was done (commit sha counts)",
        },
      },
      required: ["worktree", "id", "text"],
    },
  },
];
