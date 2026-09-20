// src/session/registry.ts — single source of truth for supported clients.
//
// Adding a client: write its reader (src/session/<name>.ts, same
// PassiveUsageResult shape as an existing one — SQLite or JSONL, whatever the
// client actually stores), then add one entry below. usage-scan iterates
// this list; nothing else needs any other change.
//
// This does not remove the real work of a new client (reverse-engineering
// its storage format) — it only removes the "wire it into 2 call sites"
// step that used to come after.

import { readClaudeCodeUsage } from "./claude-code.js";
import { readCodexUsage } from "./codex.js";
import { readPassiveUsage } from "./opencode.js";
import type { PassiveUsageReader } from "./types.js";
import { readZcodeUsage } from "./zcode.js";

export interface ClientAdapter {
  /** usage-cache.jsonl `client` field and usage-scan label default. */
  key: string;
  /** usage-scan progress label — defaults to `key`. */
  scanLabel?: string;
  /** The one client whose totals lead the report as the unlabeled top-level summary. */
  primary?: boolean;
  read: PassiveUsageReader;
}

export const CLIENTS: ClientAdapter[] = [
  {
    key: "opencode",
    primary: true,
    read: (worktree, since, until, detail, full) =>
      readPassiveUsage(worktree, since, until, { detail, full }),
  },
  { key: "zcode", read: readZcodeUsage },
  {
    key: "claude_code",
    scanLabel: "claude-code",
    read: readClaudeCodeUsage,
  },
  { key: "codex", read: readCodexUsage },
];
