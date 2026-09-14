// src/install/types.ts — shared types + constants for install providers

import { join } from "node:path";

/** Repo root (parent of src/) — absolute path to this fapony checkout,
 *  so `claude mcp add` works even before `bun link`. Same pattern as src/update.ts.
 *  Note: this file lives in src/install/, so ../.. reaches the repo root. */
export const INSTALL_ROOT = join(import.meta.dir, "..", "..");

export const MCP_KEY = "fapony";

export const MCP_CONFIG = {
  type: "local",
  command: ["bun", "run", "fapony.ts", "mcp"],
};

/** ZCode uses the stdio MCP shape: command is a string, args is an array.
 *  See ~/.zcode/cli/plugins/cache/zcode-plugins-official/zcode-guide/...
 *  (do not use OpenCode-style `command: [...]` in ZCode's JSON editor). */
export const ZCODE_MCP_CONFIG = {
  type: "stdio",
  command: "bun",
  args: ["run", join(INSTALL_ROOT, "fapony.ts"), "mcp"],
};

export const CODEX_MCP_ENTRY = `[mcp_servers.fapony]
command = "bun"
args = ["run", "${INSTALL_ROOT}/fapony.ts", "mcp"]
type = "stdio"
`;

export interface ClaudeRunResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

export interface InstallDeps {
  /** Run argv synchronously. Defaults to Bun.spawnSync. Injected in tests. */
  run?: (argv: string[]) => ClaudeRunResult;
  exit?: (code: number) => never;
  /** Override os.homedir() for tests. */
  homedir?: () => string;
  /** Prompt the user (question → answer). Injected in tests; when absent,
   *  detect/prompt path prints results and exits instead of asking. */
  ask?: (question: string, defaultVal?: string) => Promise<string>;
  /** Check if a command is on PATH. Defaults to `command -v` with allowlist. */
  checkCmd?: (cmd: string) => boolean;
}

/** Default process exit. Shared by all providers — do not duplicate. */
export function defaultExit(code: number): never {
  return process.exit(code);
}

export type SkillLinkAction = "linked" | "already" | "conflict";

export interface SkillLinkResult {
  name: string;
  action: SkillLinkAction;
}
