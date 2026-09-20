// src/debt/index.ts — barrel for `fapony debt`: which files have not moved
// to a shipped convention yet.
//
// The question nobody can answer: "which files have not moved" — rules files
// (CLAUDE.md, Cursor rules) can only say "what the rule is" (layer 2) and
// "which files were copied" (layer 1) — where the debt is (layer 3) lives in
// the owner's head and vanishes when forgotten (SPEC-convention-debt §1)
//
// The convention definition lives in the measured repo — fapony does not know
// React or Hono and must not. Layout mirrors src/mcp/: types + one file per
// concern, CLI entry in cli.ts (fapony.ts imports that directly, same as
// digest/cli.ts).

export * from "./cli.js";
export * from "./format.js";
export * from "./load.js";
export * from "./promotion.js";
export * from "./scan.js";
export * from "./types.js";
