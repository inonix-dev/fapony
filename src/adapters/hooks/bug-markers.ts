// src/adapters/hooks/bug-markers.ts — how fapony recognises "a bug was found".
//
// Split from stop.ts so the Stop hook (blocking, claude/cursor/codex) and the
// OpenCode commit hint (advisory) share one definition. A bug that lives only
// in a `note` row is not surfaced by anything, so the two signals are:
//
//   1. a structured commit-message token — `fix:` / `bugfix:` / `hotfix:`.
//      Universal by construction: only the type token is English, so a Thai
//      description on a conventional commit still reads as a bug
//      (`fix(debt): ...`). This is the language-independent signal, and it is
//      already how this repo commits (120/581 commits are fix-family).
//   2. free-text announcement phrases — inherently per-language. A substring
//      list cannot be universal; keep it small and open instead. Add your
//      language here — do NOT invent a new row kind for it (open/closed is
//      derived from close rows already; a kind would just drift).
//
// Deliberately NOT matched: symptom words ("broken", "dies silently"). They
// appear in every bug report and would fire on any turn that reads one — the
// Stop hook blocks once per session on a match, so a false positive is costly.

/** Free-text announcement phrases ("I found a bug"), never symptom words.
 *  `g` flag is required — hasBugMarker walks every match (matchAll). */
export const BUG_MARKERS: RegExp[] = [
  /(?:เจอ|พบ)(?:ว่า)?(?:เป็น)?บั๊ก/g, // พบบั๊ก · พบว่าเป็นบั๊กจริง
  /บั๊กที่(?:เจอ|พบ)/g,
  /\bfound (?:a |the )?(?:real |actual )?bug\b/gi,
  /\b(?:this|that|it)(?:'s| is) a (?:real )?bug\b/gi,
  /\b(?:bug confirmed|confirmed (?:a |real )?bug)\b/gi,
  /\bbug\b\s*(?:\([^)\n]{0,80}\))?\s*:/gi, // **Bug (cause…):**
];

// Negation / hypothetical right before a match ("ไม่พบบั๊ก", "จะเจอบั๊ก",
// "not a bug"). Bare "เป็นบั๊ก" is deliberately not a marker: "อาจเป็นบั๊ก" is
// everywhere and a false fire costs a Stop-hook block.
const NEGATED = /(?:ไม่|จะ|ถ้า|อาจ|\bnot\s|\bno\s|\bif\s)\s*$/i;

/**
 * The matched marker phrase, or null. Returns the matched text so the caller
 * can quote it back to the agent (stop.ts does, in its block reason). Every
 * match is checked, so "ไม่พบบั๊กใหม่ แต่เจอบั๊กที่ X" still fires on the second.
 */
export function hasBugMarker(text: string): string | null {
  for (const re of BUG_MARKERS) {
    for (const m of text.matchAll(re)) {
      const before = text.slice(Math.max(0, m.index - 15), m.index);
      if (!NEGATED.test(before)) return m[0];
    }
  }
  return null;
}

// Conventional-commit bug types, anchored to the subject prefix — arbitrary
// prose containing "fix" ("pre-fix the cache") must not match. Language-free:
// the type token stays English even when the description is not.
const BUGFIX_COMMIT = /^(?:fix|bugfix|hotfix)(?:\([^)]*\))?!?:/;

/** True when a commit subject declares a fix (the universal bug token). */
export function isBugfixCommit(subject: string): boolean {
  return BUGFIX_COMMIT.test(subject.trim());
}
