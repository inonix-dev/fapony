import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { CONFIG_FILENAME, DEFAULT_CONFIG } from "./defaults.js";
import type { Config } from "./types.js";

// XDG Base Directory convention (macOS ignores Apple's ~/Library/Application Support
// for CLI tools by common practice — gh, ripgrep-adjacent tools, etc. use ~/.config too)
// Override order: $FAPONY_STATE_DIR > config.paths.stateDir > $XDG_CONFIG_HOME > ~/.config
export function faponyDir(config?: Config): string {
  if (process.env.FAPONY_STATE_DIR) return process.env.FAPONY_STATE_DIR;
  if (config?.paths?.stateDir) return config.paths.stateDir;
  const base = process.env.XDG_CONFIG_HOME || join(homedir(), ".config");
  return join(base, "fapony");
}

function _dbPath(config?: Config): string {
  return join(faponyDir(config), "state.db");
}

export function configFilePath(): string {
  if (process.env.FAPONY_CONFIG) return process.env.FAPONY_CONFIG;
  return join(process.cwd(), CONFIG_FILENAME);
}

function freshDefaultConfig(): Config {
  return {
    ...DEFAULT_CONFIG,
    worktrees: { ...DEFAULT_CONFIG.worktrees },
    review: {
      ...DEFAULT_CONFIG.review,
    },
  };
}

export function loadConfig(configPath?: string): Config {
  const resolved = configPath ?? configFilePath();
  if (!existsSync(resolved)) return freshDefaultConfig();

  try {
    const raw = readFileSync(resolved, "utf-8");
    const file = JSON.parse(raw) as Partial<Config>;

    return {
      ...DEFAULT_CONFIG,
      ...file,
      review: {
        ...DEFAULT_CONFIG.review,
        ...file.review,
      },
      paths: file.paths ? { ...file.paths } : DEFAULT_CONFIG.paths,
      safety: file.safety ? { ...file.safety } : DEFAULT_CONFIG.safety,
    };
  } catch {
    return freshDefaultConfig();
  }
}
