// src/core/defaults.ts — shared constants (pure, no db/state deps)

export const DEFAULT_SAFETY_DENY = [
  "reset\\s+--hard",
  "clean\\s+-[a-z]*f",
  "checkout\\s+--\\s",
  "git\\s+stash",
];
