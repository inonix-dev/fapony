// src/adapters/hooks/git-autonomy.ts — git-autonomy rewrites as shared logic.
//
// A personal opencode plugin (~/.config/opencode/plugins/git-autonomy.ts)
// rewrote opencode's built-in "never commit unless asked" policy on two
// surfaces: the system prompt (experimental.chat.system.transform) and the
// bash tool description (tool.definition). This module is that file's logic,
// extracted so `fapony install --platform opencode --git-autonomy` can
// generate a thin plugin that imports it — one copy, updated by `git pull`,
// same shape as the read/commit/edit/session-start hints.
//
// Opt-in only: the installer never writes this unless the flag is passed.
// The rewrite itself is an opinion (commit-as-you-go), not a utility, so it
// must never ride the default install path.
//
// Stale-regex guard (the "rots silently" problem): upstream text lives in the
// opencode binary, not in a file, so a reword upstream makes a pattern stop
// matching with no error. Every rewrite carries `required`; `gitAutonomyStatus`
// reports required ids that hit nothing — the analyze-like help for this
// feature. The tone-example cut is required:false: versions without those
// examples are fine, a missing commit policy is not.

/** Commit-as-you-go policy replacing opencode's ask-first rule. */
export const GIT_AUTONOMY_COMMIT_POLICY =
  "Commit each finished unit of work as you go — do not wait to be asked. If the user wants to review before a commit they will say so.";

/** Same policy, bash-tool-description surface. */
export const GIT_AUTONOMY_TOOL_POLICY =
  "Commit finished work as you go — do not wait to be asked; never amend published commits or force-push.";

export const GIT_AUTONOMY_PLUGIN_FILE = "fapony-git-autonomy.ts";
export const GIT_AUTONOMY_PLUGIN_NAME = "FaponyGitAutonomy";

export interface GitAutonomyRewrite {
  /** Stable id used by gitAutonomyStatus to name the stale pattern. */
  id: string;
  pattern: RegExp;
  replacement: string;
  /** False = a miss is fine (upstream dropped that text). True = a miss is rot. */
  required: boolean;
}

export const GIT_AUTONOMY_SYSTEM_REWRITES: GitAutonomyRewrite[] = [
  {
    id: "system-commit-full",
    pattern: /NEVER commit changes[\s\S]{0,500}?too proactive\./g,
    replacement: GIT_AUTONOMY_COMMIT_POLICY,
    required: true,
  },
  {
    id: "system-commit-fallback",
    pattern: /NEVER commit changes[^.]*\./g,
    replacement: GIT_AUTONOMY_COMMIT_POLICY,
    required: true,
  },
  {
    id: "system-bash-desc",
    pattern:
      /- Only commit, amend, push, or create PRs when explicitly requested\./g,
    replacement:
      "- Commit and push finished work as you go, and open a PR when a branch is ready. Do not amend published commits or force-push.",
    required: true,
  },
  {
    // "# Tone and style" few-shot examples: from the intro down to the next
    // heading. Anchored on the unique intro so no other <example> block is
    // touched. Pure token rent — the surrounding sentences already state the
    // terseness rules.
    id: "system-tone-examples",
    pattern:
      /Here are some examples to demonstrate appropriate verbosity:[\s\S]*?(?=\n# )/g,
    replacement: "",
    required: false,
  },
];

export interface GitAutonomyToolRewrite extends GitAutonomyRewrite {
  toolID: string;
}

export const GIT_AUTONOMY_TOOL_REWRITES: GitAutonomyToolRewrite[] = [
  {
    id: "tool-bash-commit",
    toolID: "bash",
    pattern:
      /- Only commit, amend, push, or create PRs when explicitly requested\./g,
    replacement: `- ${GIT_AUTONOMY_TOOL_POLICY}`,
    required: true,
  },
];

function fresh(re: RegExp): RegExp {
  // /g patterns are stateful via lastIndex — clone so repeated calls and
  // .test-then-.replace sequences never skip a match.
  return new RegExp(re.source, re.flags);
}

/**
 * Apply the system-prompt rewrites. Returns the rewritten text plus the ids
 * that fired, in order — the caller (plugin) ignores the second half, tests
 * and gitAutonomyStatus use it to tell "rewrote" from "silently missed".
 */
export function rewriteGitAutonomySystem(text: string): {
  text: string;
  matched: string[];
} {
  const matched: string[] = [];
  let out = text;
  for (const r of GIT_AUTONOMY_SYSTEM_REWRITES) {
    const re = fresh(r.pattern);
    if (re.test(out)) {
      matched.push(r.id);
      out = out.replace(fresh(r.pattern), r.replacement);
      // The loose fallback must never run once the full block was replaced.
      if (r.id === "system-commit-full") break;
    }
  }
  return { text: out, matched };
}

/** Apply the tool.description rewrites for one toolID. */
export function rewriteGitAutonomyTool(
  toolID: string,
  description: string,
): { description: string; matched: string[] } {
  const matched: string[] = [];
  let out = description;
  for (const r of GIT_AUTONOMY_TOOL_REWRITES) {
    if (r.toolID !== toolID) continue;
    const re = fresh(r.pattern);
    if (re.test(out)) {
      matched.push(r.id);
      out = out.replace(fresh(r.pattern), r.replacement);
    }
  }
  return { description: out, matched };
}

export interface GitAutonomyStatus {
  /** Required ids that fired at least once across the inputs. */
  hits: string[];
  /** Required ids that hit nothing — upstream reworded or moved the text. */
  stale: string[];
  /** True when no required pattern is stale. */
  ok: boolean;
}

/**
 * Analyze-like help for this feature: feed the current opencode system lines
 * + tool descriptions, get back which required patterns are stale. Optional
 * rewrites (tone examples) never appear in `stale` — their absence is fine.
 */
export function gitAutonomyStatus(
  systemTexts: string[],
  toolDescs: Record<string, string>,
): GitAutonomyStatus {
  const seen = new Set<string>();
  for (const t of systemTexts) {
    for (const id of rewriteGitAutonomySystem(t).matched) seen.add(id);
  }
  for (const [toolID, desc] of Object.entries(toolDescs)) {
    for (const id of rewriteGitAutonomyTool(toolID, desc).matched) seen.add(id);
  }
  const requiredIds = new Set<string>();
  for (const r of GIT_AUTONOMY_SYSTEM_REWRITES)
    if (r.required) requiredIds.add(r.id);
  for (const r of GIT_AUTONOMY_TOOL_REWRITES)
    if (r.required) requiredIds.add(r.id);
  // system-commit-full and system-commit-fallback are two spellings of one
  // policy: either hit means the policy landed, only both missing is stale.
  const commitHit =
    seen.has("system-commit-full") || seen.has("system-commit-fallback");
  const hits = [...seen].filter((id) => requiredIds.has(id));
  const stale: string[] = [];
  if (!commitHit) stale.push("system-commit");
  if (!seen.has("system-bash-desc")) stale.push("system-bash-desc");
  if (!seen.has("tool-bash-commit")) stale.push("tool-bash-commit");
  return { hits, stale, ok: stale.length === 0 };
}
