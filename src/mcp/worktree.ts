// src/mcp/worktree.ts — resolve worktree argument to absolute path

import { loadConfig } from "../db/load.js";

const SENTINEL_MCP_EXTERNAL = "mcp-external";

/**
 * Resolve a worktree argument to an absolute path.
 * - Absolute paths (contain "/") pass through unchanged
 * - Keys are looked up in config.worktrees
 * - "mcp-external" sentinel passes through (used when no worktree is available)
 * - Throws if key not found in config
 */
export function resolveWorktreeArg(value: string): string {
  if (value === SENTINEL_MCP_EXTERNAL) return value;
  if (value.includes("/")) return value;

  const config = loadConfig();
  const resolved = config.worktrees[value];
  if (resolved) return resolved;

  const keys = Object.keys(config.worktrees);
  throw new Error(
    `worktree "${value}" is not an absolute path and not found in config.worktrees. ` +
      `Send an absolute path (containing "/") or one of these keys: ${keys.length ? keys.join(", ") : "(none configured)"}`,
  );
}
