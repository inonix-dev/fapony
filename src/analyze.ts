// src/analyze.ts — `fapony analyze`: structural health diagnosis for a TS/JS project.
//
// Barrel only (compat — 14 importers use "../analyze.js", unchanged).
// Layout mirrors src/install/ and src/debt/: types + one file per concern.
//   types.ts      ImportGraph / Finding / BlastEntry
//   criteria.ts   isTestFile / isBarrelSource / isTestedThroughBarrels
//   discover.ts   SCAN_EXTS / isSkippedDir / collectSourceFiles
//   resolve-ts.ts TS require()/import-type + resolveRelative
//   python.ts     .py import scan + resolution
//   barrels.ts    exportsThroughBarrels (star re-exports)
//   graph.ts      buildGraph (live, Bun.Transpiler.scan(), never persisted)
//   cache.ts      buildGraphCached (session-scoped, state dir only)
//   diagnose.ts   diagnose (hub-untested/orphan/cycle/changed-untested)
//   blast.ts      blastRadius / blastRadiusForWorktree
//   format.ts     formatAnalyze
//   cli.ts        cmdAnalyze

export * from "./analyze/index.js";
