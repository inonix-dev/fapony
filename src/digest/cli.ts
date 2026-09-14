// src/digest/cli.ts — fapony digest CLI
//
// fapony digest [--since <7d|YYYY-MM-DD>] [--format text|html] [--json] [--out <file>]

import { writeFileSync } from "node:fs";
import { collectDigest } from "./collect.js";
import { renderDigestHtml } from "./html.js";
import { renderDigestText } from "./text.js";

export async function cmdDigest(args: string[]): Promise<void> {
  let since: string | undefined;
  let format: "text" | "html" = "text";
  let json = false;
  let out: string | undefined;

  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--since" && i + 1 < args.length) {
      since = args[++i];
    } else if (a === "--format" && i + 1 < args.length) {
      const f = args[++i];
      if (f !== "text" && f !== "html") {
        console.error(
          `fapony digest: unknown format "${f}" — use text or html`,
        );
        process.exit(1);
      }
      format = f;
    } else if (a === "--json") {
      json = true;
    } else if (a === "--out" && i + 1 < args.length) {
      out = args[++i];
    } else if (a === "--help" || a === "-h") {
      console.log(
        "usage: fapony digest [--since <7d|YYYY-MM-DD>] [--format text|html] [--json] [--out <file>]",
      );
      process.exit(0);
    } else {
      console.error(`fapony digest: unknown flag "${a}"`);
      console.error(
        "usage: fapony digest [--since <7d|YYYY-MM-DD>] [--format text|html] [--json] [--out <file>]",
      );
      process.exit(1);
    }
  }

  try {
    const data = await collectDigest({ since });

    let output: string;
    if (json) {
      output = JSON.stringify(data, null, 2);
    } else if (format === "html") {
      output = renderDigestHtml(data);
    } else {
      output = renderDigestText(data);
    }

    if (out) {
      writeFileSync(out, output, "utf-8");
      console.error(`written to ${out}`);
    } else {
      process.stdout.write(`${output}\n`);
    }
  } catch (err) {
    if (
      err instanceof Error &&
      err.message.startsWith("invalid --since format:")
    ) {
      console.error(`fapony digest: ${err.message}`);
      process.exit(1);
    }
    throw err;
  }
}
