// src/install/opencode.ts — OpenCode install provider
//
// Writes fapony's generated plugin (opt-in git-autonomy) into
// ~/.config/opencode/plugins and symlinks skills. Memory (MCP, commit hint,
// session start, per-file read context) moved to fael — `fael install`.

import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { claudeSkillsDir, linkSkills, reportSkills } from "./skills.js";
import { INSTALL_ROOT, type InstallDeps } from "./types.js";

export function findOpencodeConfig(getHome: () => string): string | null {
  const dir = join(getHome(), ".config", "opencode");
  for (const name of ["opencode.json", "opencode.jsonc"]) {
    const p = join(dir, name);
    if (existsSync(p)) return p;
  }
  return null;
}

export interface OpencodeInstallOpts {
  /** Opt-in only: write the git-autonomy rewrite plugin. Never default. */
  gitAutonomy?: boolean;
  /** Refresh only the generated plugin bodies — skip the opencode.json write
   *  and the skills symlink entirely. This is `fapony update`'s post-pull
   *  refresh: it must touch only fapony-owned plugin files, never the user's
   *  config (rule 6c — overwriting what exists = ask first, or refuse). */
  pluginsOnly?: boolean;
}

export function cmdInstallOpencode(
  dryRun: boolean,
  deps: InstallDeps = {},
  opts: OpencodeInstallOpts = {},
): void {
  const getHome = deps.homedir ?? homedir;

  if (!opts.pluginsOnly) {
    const skillsDir = claudeSkillsDir(getHome);
    reportSkills(linkSkills(skillsDir, dryRun), skillsDir, dryRun);
  }
  for (const [fileName, ownedName] of RETIRED_PLUGINS) {
    removeRetiredPlugin(dryRun, getHome, fileName, ownedName);
  }
  if (opts.gitAutonomy) installGitAutonomyPlugin(dryRun, getHome);
}

/** Plugins fapony used to write — memory hints (now fael's) and the edit hint
 *  (cut 2026-09-26). Their bodies import exports src/hook.ts no longer has, so
 *  a leftover copy would fail to load inside OpenCode: remove ours (by owned
 *  name), never a foreign file. */
const RETIRED_PLUGINS: [string, string][] = [
  ["fapony-read-hint.ts", "FaponyReadHint"],
  ["fapony-commit-hint.ts", "FaponyCommitHint"],
  ["fapony-session-start.ts", "FaponySessionStart"],
  ["fapony-edit-hint.ts", "FaponyEditHint"],
];

function removeRetiredPlugin(
  dryRun: boolean,
  getHome: () => string,
  fileName: string,
  ownedName: string,
): void {
  const pluginPath = join(
    getHome(),
    ".config",
    "opencode",
    "plugins",
    fileName,
  );
  let current: string;
  try {
    current = readFileSync(pluginPath, "utf-8");
  } catch {
    return;
  }
  if (!current.includes(ownedName)) return;
  if (!dryRun) {
    try {
      rmSync(pluginPath);
    } catch (e) {
      console.error(
        `  ${fileName}: failed to remove — ${(e as Error).message}`,
      );
      return;
    }
  }
  console.error(
    `  ${fileName}: ${dryRun ? "would remove" : "removed"} (retired plugin)`,
  );
}

/**
 * Write one generated OpenCode plugin file, refreshing our own older copy.
 *
 * Ownership is the exported plugin name (`FaponyReadHint`, …) — the one token
 * every generated body carries. A file without it is someone's own plugin and
 * is never touched, same rule as the skill symlinks. A file *with* it but
 * different content is ours and stale: the plugin body is baked at install
 * time, so a `git pull` updates the imported logic (src/hook.ts) but never this
 * file. Refusing to overwrite it is how an old hook stays reachable forever —
 * the Thai-only bug marker survived exactly that way — so ours gets rewritten
 * in place, and only a foreign file is reported and left alone.
 */
function installPluginFile(
  dryRun: boolean,
  getHome: () => string,
  fileName: string,
  label: string,
  ownedName: string,
  desired: string,
): void {
  const pluginsDir = join(getHome(), ".config", "opencode", "plugins");
  const pluginPath = join(pluginsDir, fileName);
  const write = (): boolean => {
    if (dryRun) return true;
    try {
      mkdirSync(pluginsDir, { recursive: true });
      writeFileSync(pluginPath, desired, "utf-8");
      return true;
    } catch (e) {
      console.error(`  ${label}: failed to write — ${(e as Error).message}`);
      return false;
    }
  };

  if (!existsSync(pluginPath)) {
    if (write()) {
      console.error(
        `  ${label}: ${dryRun ? "would write" : "wrote"} ${pluginPath}`,
      );
    }
    return;
  }

  let current = "";
  try {
    current = readFileSync(pluginPath, "utf-8");
  } catch {
    current = "";
  }
  if (current === desired) {
    console.error(`  ${label}: already installed — no change`);
    return;
  }
  if (!current.includes(ownedName)) {
    console.error(
      `  ${label}: ${pluginPath} exists but isn't fapony's — not overwriting.`,
    );
    return;
  }
  if (write()) {
    console.error(
      `  ${label}: ${dryRun ? "would update" : "updated"} ${pluginPath}`,
    );
  }
}

/**
 * OpenCode plugin — git-autonomy rewrites, the parity of the personal
 * `git-autonomy.ts` plugin. Two hooks because the policy lives on two
 * surfaces the other never sees:
 * `experimental.chat.system.transform` (system prompt) + `tool.definition`
 * (bash tool description).
 *
 * OPT-IN ONLY — written only when `fapony install` gets `--git-autonomy`.
 * Never on the default path, never via `--all` unless the flag rides along.
 * The policy is an opinion (commit-as-you-go), not a utility, and the file
 * name is `fapony-git-autonomy.ts`: the user's own `git-autonomy.ts` is a
 * different file and is never touched — delete it by hand after verifying.
 *
 * Logic lives in src/adapters/hooks/git-autonomy.ts
 * (rewriteGitAutonomySystem / rewriteGitAutonomyTool) — the plugin imports
 * it from the install root, so `git pull` updates every client. No baked
 * regex in the generated body: a baked copy would rot silently when upstream
 * rewords the policy, the same failure this module's gitAutonomyStatus
 * exists to name. Never throws: a rewrite must not break a session start
 * or hide a tool.
 */
export function gitAutonomyPluginSource(root: string): string {
  const hookModule = JSON.stringify(join(root, "src", "hook.ts"));
  return `// fapony git-autonomy — rewrites opencode's ask-first git policy to
// commit-as-you-go on both surfaces that carry it (system prompt +
// bash tool description), and cuts the tone few-shot examples.
// OPT-IN: written only by \`fapony install --platform opencode --git-autonomy\`.
// Generated by \`fapony install\` — logic lives in src/adapters/hooks/git-autonomy.ts.
import { rewriteGitAutonomySystem, rewriteGitAutonomyTool } from ${hookModule};

export const FaponyGitAutonomy = async () => ({
  "experimental.chat.system.transform": async (
    _input: unknown,
    output: { system: string[] },
  ) => {
    try {
      for (let i = 0; i < output.system.length; i++) {
        output.system[i] = rewriteGitAutonomySystem(output.system[i]).text;
      }
    } catch {
      // a rewrite must never break a session start
    }
  },
  "tool.definition": async (
    input: { toolID: string },
    output: { description: string; parameters: unknown },
  ) => {
    try {
      const r = rewriteGitAutonomyTool(input.toolID, output.description);
      output.description = r.description;
    } catch {
      // a rewrite must never hide a tool
    }
  },
});
`;
}

function installGitAutonomyPlugin(
  dryRun: boolean,
  getHome: () => string,
): void {
  installPluginFile(
    dryRun,
    getHome,
    "fapony-git-autonomy.ts",
    "git-autonomy",
    "FaponyGitAutonomy",
    gitAutonomyPluginSource(INSTALL_ROOT),
  );
}

/** The fapony-generated plugin files present in an OpenCode install. Empty =
 *  OpenCode has none, so `fapony update` must not install into a client the user
 *  never opted into. Callers also use it to tell whether the opt-in git-autonomy
 *  plugin is installed, so an update can refresh it without ever creating it. */
export function opencodePluginFiles(getHome: () => string = homedir): string[] {
  const pluginsDir = join(getHome(), ".config", "opencode", "plugins");
  try {
    return readdirSync(pluginsDir).filter(
      (f) => f.startsWith("fapony-") && f.endsWith(".ts"),
    );
  } catch {
    return [];
  }
}
