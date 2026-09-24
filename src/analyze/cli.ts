// src/analyze/cli.ts — `fapony analyze` CLI entry.

import { existsSync } from "node:fs";
import { resolve } from "node:path";

import { diagnose } from "./diagnose.js";
import { formatAnalyze } from "./format.js";
import { buildGraph } from "./graph.js";
import type { ImportGraph } from "./types.js";

export function cmdAnalyze(args: string[]): void {
  const dir = args[0] ?? ".";
  const absDir = resolve(dir);
  if (!existsSync(absDir)) {
    console.error(`fapony analyze: "${dir}" does not exist`);
    process.exit(1);
  }
  let graph: ImportGraph;
  try {
    graph = buildGraph(absDir);
  } catch (e) {
    console.error(
      `fapony analyze: cannot scan "${dir}": ${e instanceof Error ? e.message : String(e)}`,
    );
    process.exit(1);
  }
  console.log(formatAnalyze(graph, diagnose(graph)));
}
