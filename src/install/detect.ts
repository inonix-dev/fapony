// src/install/detect.ts — detect which agent clients are installed on this machine.
//
// Signal per client:
//   antigravity = ~/.gemini exists (the app creates it on first run) OR `agy` on PATH
//   claude      = `command -v claude` (CLI on PATH)
//   opencode    = ~/.config/opencode/{opencode.json,opencode.jsonc} exists
//   zcode       = ~/.zcode/cli/config.json or ~/.agents/mcp.json exists
//   codex       = ~/.codex/config.toml exists

import { homedir } from "node:os";
import { defaultCheckCmd } from "../setup.js";
import { findGeminiDir } from "./antigravity.js";
import { findCodexConfig } from "./codex.js";
import { findOpencodeConfig } from "./opencode.js";
import type { InstallDeps } from "./types.js";
import { findZcodeConfig } from "./zcode.js";

export interface DetectedClient {
  platform: string;
  installed: boolean;
  why: string;
}

/**
 * Detect which agent clients are available on this machine.
 * Returns one entry per platform, ordered: antigravity, claude, opencode, zcode, codex.
 *
 * Uses resolvers from each provider (file/dir-exists check) for
 * antigravity/opencode/zcode/codex, and `command -v claude`/`command -v agy`
 * for claude/antigravity — all through injected deps for testability.
 */
export function detectClients(deps: InstallDeps = {}): DetectedClient[] {
  const getHome = deps.homedir ?? homedir;
  const checkCmd = deps.checkCmd ?? defaultCheckCmd;

  const claude = checkCmd("claude");
  const agy = checkCmd("agy");

  const geminiDir = findGeminiDir(getHome);
  const opencodePath = findOpencodeConfig(getHome);
  const zcodeResult = findZcodeConfig(getHome);
  const codexPath = findCodexConfig(getHome);

  return [
    {
      platform: "antigravity",
      installed: geminiDir !== null || agy,
      why: geminiDir
        ? `dir at ${geminiDir}`
        : agy
          ? "agy CLI on PATH"
          : "no ~/.gemini directory (open Antigravity once)",
    },
    {
      platform: "claude",
      installed: claude,
      why: claude ? "claude CLI on PATH" : "claude CLI not found on PATH",
    },
    {
      platform: "opencode",
      installed: opencodePath !== null,
      why: opencodePath
        ? `config at ${opencodePath}`
        : "no config file (~/.config/opencode/{opencode.json,opencode.jsonc})",
    },
    {
      platform: "zcode",
      installed: zcodeResult !== null,
      why: zcodeResult
        ? `config at ${zcodeResult.path}`
        : "no config file (~/.zcode/cli/config.json or ~/.agents/mcp.json)",
    },
    {
      platform: "codex",
      installed: codexPath !== null,
      why: codexPath
        ? `config at ${codexPath}`
        : "no config file (~/.codex/config.toml)",
    },
  ];
}
