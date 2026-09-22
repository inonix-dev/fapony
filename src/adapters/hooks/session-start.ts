// src/adapters/hooks/session-start.ts — SessionStart hook: emit mem kickoff
// as context.
//
// Split from src/hook.ts (PLAN-lib-layer chunk 3). sessionStartContext is the
// one copy shared by Claude/Codex CLI and the generated OpenCode plugin.

import { whereMemDir } from "../../memory.js";

/** Cap on injected context — kickoff is short, a broken repo's output is not. */
export const SESSION_START_MAX_CHARS = 4_000;

const TRUNCATED = "… truncated — run `fapony mem find <word>` for the rest";

/** Trim to whole lines, keeping the marker's line boundary intact. */
function headLines(text: string, max: number): string {
  const cut = text.slice(0, max);
  const lastNl = cut.lastIndexOf("\n");
  return (lastNl > 0 ? cut.slice(0, lastNl) : cut).trimEnd();
}

/**
 * Trim to whole lines within the cap, with an honest truncation marker.
 *
 * Kickoff's ordering is: ranked rows → "## next up" → "## recent". The
 * most actionable content is at the top (bugs, diff-matched) and in "## next
 * up". A plain head-cut drops the suggestions — so we try to keep "## next up"
 * visible. When "## recent" exists, we cut it first; otherwise fall back to
 * keeping "## next up" at the tail.
 */
export function capContext(
  text: string,
  max = SESSION_START_MAX_CHARS,
): string {
  if (text.length <= max) return text;
  const recentIdx = text.indexOf("\n## recent");
  if (recentIdx > 0) {
    const head = text.slice(0, recentIdx).trimEnd();
    if (head.length <= max) return head;
    const nextIdx = head.lastIndexOf("\n## next up");
    if (nextIdx > 0) {
      const beforeNext = head.slice(0, nextIdx).trimEnd();
      const nextTail = head.slice(nextIdx).trimEnd();
      if (nextTail.length < max / 2) {
        return `${headLines(beforeNext, max - nextTail.length)}\n${TRUNCATED}\n${nextTail}`;
      }
    }
    return `${headLines(head, max)}\n${TRUNCATED}`;
  }
  const at = text.lastIndexOf("\n## next up");
  const tail = at > 0 ? text.slice(at).trimEnd() : "";
  if (tail && tail.length < max / 2) {
    return `${headLines(text, max - tail.length)}\n${TRUNCATED}\n${tail}`;
  }
  return `${headLines(text, max)}\n${TRUNCATED}`;
}

/**
 * Kickoff output for `cwd`'s mem log, capped — or null when there is no log in
 * scope, the command fails, or it prints nothing. The single implementation
 * behind both cmdHookSessionStart (Claude/Codex) and the generated OpenCode
 * plugin, so a pull of INSTALL_ROOT updates all three.
 *
 * `faponyTs` is where the CLI lives. The hook defaults to `Bun.main` (itself,
 * when run as `bun <root>/fapony.ts hook-session-start`); the OpenCode plugin
 * must pass its baked path because `Bun.main` inside OpenCode is OpenCode's own
 * entry, not fapony's.
 */
export function sessionStartContext(
  cwd: string,
  faponyTs: string = Bun.main,
): string | null {
  // Resolution shares one function with every reader. A bare monorepo root has
  // no log at/above cwd, so the resolver reports the app-scoped log only as an
  // out-of-scope candidate (SPEC §1). For a *read* at session start that is
  // still recoverable: if the whole repo holds exactly one log, it is the
  // project's memory — point kickoff at it with --mem-dir. Two or more is
  // genuinely ambiguous (which app?), so refuse exactly as the resolver does.
  const resolved = whereMemDir(cwd);
  const memArgs: string[] = [];
  if (!resolved.dir) {
    const candidates = resolved.candidates ?? [];
    if (candidates.length !== 1) return null;
    memArgs.push("--mem-dir", candidates[0]);
  }
  const p = Bun.spawnSync(
    [process.execPath, faponyTs, "mem", ...memArgs, "kickoff"],
    { cwd, stdout: "pipe", stderr: "pipe" },
  );
  const out = p.stdout.toString().trim();
  if (p.exitCode !== 0 || !out) return null;
  return capContext(out);
}

/** SessionStart hook: emit sessionStartContext as Claude/Codex JSON. */
export async function cmdHookSessionStart(): Promise<void> {
  try {
    const raw = JSON.parse(await Bun.stdin.text()) as { cwd?: string };
    const cwd = raw.cwd ?? process.cwd();
    const ctx = sessionStartContext(cwd);
    if (!ctx) return;
    console.log(
      JSON.stringify({
        hookSpecificOutput: {
          hookEventName: "SessionStart",
          additionalContext: ctx,
        },
      }),
    );
  } catch {
    // any failure = no context, never a broken session start
  }
}
