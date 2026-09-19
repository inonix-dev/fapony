// commands/write.ts — mutating commands: add, close, claim, release, synced, hook

import { claimsOf, openRows } from "../selectors.js";
import type { WorkKind } from "../store.js";
import { KINDS, memCmd, nextId, put, root, rows } from "../store.js";

export const cmdAdd = async (a: string[]) => {
  // mem add <next|bug|decision|note|hold> "<text>" --files f1,f2 [path/to/SPEC.md]
  // mem add <kind> --stdin --files f1,f2 [spec.md]  ← read text from stdin (avoids shell metachar issues)
  // ponytail: a wrong kind = that row silently vanishes from the view — better to die right here
  if (!KINDS.includes(a[0] as WorkKind)) {
    console.error(
      `kind must be one of ${KINDS.join("|")} — got "${a[0] ?? ""}"`,
    );
    process.exit(1);
  }
  // hold requires a spec — checked after parse (the spec may come before --files)
  // PLAN-convention-debt chunk 3: files[] is required — a measured optional field
  // had fill rate 0 (required+enum = 50/50) and recall on old logs without files[] caught only
  // 48.1% — fix the write side, not the read side: a row that does not name the file = unfindable when you touch that file
  const filesFlagIdx = a.indexOf("--files");
  const filesVal = filesFlagIdx >= 0 ? a[filesFlagIdx + 1] : undefined;
  if (!filesVal || filesVal.startsWith("--")) {
    console.error(
      `--files is required — usage: ${memCmd} add ${a[0]} "<text>" --files path/to/file.ts[,more] [spec.md]`,
    );
    process.exit(1);
  }
  const files = filesVal
    .split(",")
    .map((s) => s.trim().replace(/^\.\//, ""))
    .filter(Boolean);
  if (files.length === 0) {
    console.error(
      `--files needs at least one path — usage: ${memCmd} add ${a[0]} "<text>" --files path/to/file.ts[,more]`,
    );
    process.exit(1);
  }
  const arg = a.slice(1);
  const useStdin = arg.includes("--stdin");
  const filtered = arg.filter(
    (x) => x !== "--stdin" && x !== "--files" && x !== filesVal,
  );
  const spec = filtered.at(-1)?.endsWith(".md") ? filtered.pop() : undefined;
  if (a[0] === "hold" && !spec) {
    console.error(
      `hold requires a spec — usage: ${memCmd} add hold "..." --files f1,f2 <spec.md>`,
    );
    process.exit(1);
  }
  let text: string;
  if (useStdin) {
    text = (await Bun.stdin.text()).trim();
    if (!text) {
      console.error("stdin was empty — text is required");
      process.exit(1);
    }
  } else {
    // text is required
    if (!filtered.length || (filtered.length === 0 && !spec)) {
      console.error(
        `text is required — usage: ${memCmd} add <kind> "<text>" --files f1,f2 [spec.md]`,
      );
      process.exit(1);
    }
    text = filtered.join(" ");
  }
  // read once — cap check + id collision
  const all = rows();
  // ponytail: a cap on open next/hold stops endless accumulation — forces triage of the old before opening new
  const CAP = 15;
  const CAP_HOLD = 10;
  if (a[0] === "next" && !process.env.MEM_FORCE) {
    const openNext = openRows(all).filter((r) => r.kind === "next").length;
    if (openNext >= CAP) {
      console.error(
        `open next ${openNext}/${CAP} is full — close an old one first (or MEM_FORCE=1 if you really must)`,
      );
      process.exit(1);
    }
  }
  if (a[0] === "hold" && !process.env.MEM_FORCE) {
    const openHold = openRows(all).filter((r) => r.kind === "hold").length;
    if (openHold >= CAP_HOLD) {
      console.error(
        `open hold ${openHold}/${CAP_HOLD} is full — close/release an old one first (or MEM_FORCE=1)`,
      );
      process.exit(1);
    }
  }
  // ponytail: prevent id collisions — logic centralized in nextId (store.ts)
  const id = nextId(all);
  put({ id, kind: a[0] as WorkKind, text, spec, files });
  console.log(id);
};

export const cmdClose = async (a: string[]) => {
  // mem close <id> "<what was done / commit>" — the tombstone voids the claim by itself
  // mem close <id> --stdin ← read text from stdin
  if (!a[0]) {
    console.error(`id is required — usage: ${memCmd} close <id> "<text>"`);
    process.exit(1);
  }
  if (!rows().some((r) => "id" in r && r.id === a[0])) {
    console.error(`no id "${a[0]}" in the log`);
    process.exit(1);
  }
  const rest = a.slice(1);
  const useStdin = rest.includes("--stdin");
  let text: string;
  if (useStdin) {
    text = (await Bun.stdin.text()).trim();
  } else {
    text = rest.join(" ");
  }
  put({ kind: "close", ref: a[0], text });
};

export const cmdClaim = (a: string[]) => {
  // mem claim <id> — id must be real, open, kind=next|bug, with no active claim pending
  if (!a[0]) {
    console.error(`id is required — usage: ${memCmd} claim <id>`);
    process.exit(1);
  }
  const all = rows();
  const open = openRows(all);
  const target = open.find((r) => r.id === a[0]);
  if (!target) {
    const exists = all.find((r) => "id" in r && r.id === a[0]);
    console.error(
      exists
        ? `id "${a[0]}" exists but is already closed (close tombstone)`
        : `no id "${a[0]}" in the log`,
    );
    process.exit(1);
  }
  if (target.kind !== "next" && target.kind !== "bug") {
    console.error(
      `only next/bug can be claimed — id "${a[0]}" is ${target.kind}`,
    );
    process.exit(1);
  }
  const claims = claimsOf(all);
  if (claims.has(a[0])) {
    const c = claims.get(a[0])!;
    console.error(
      `id "${a[0]}" is already claimed by ${c.agent} — release it first`,
    );
    process.exit(1);
  }
  put({ kind: "claim", ref: a[0] });
  console.log(`claimed ${a[0]}`);
};

export const cmdRelease = async (a: string[]) => {
  // mem release <id> "<reason>?"
  // mem release <id> --stdin ← read text from stdin
  if (!a[0]) {
    console.error(`id is required — usage: ${memCmd} release <id> [reason]`);
    process.exit(1);
  }
  const all = rows();
  const claims = claimsOf(all);
  if (!claims.has(a[0])) {
    console.error(`id "${a[0]}" has no active claim`);
    process.exit(1);
  }
  const rest = a.slice(1);
  const useStdin = rest.includes("--stdin");
  let text: string | undefined;
  if (useStdin) {
    const t = (await Bun.stdin.text()).trim();
    text = t || undefined;
  } else {
    text = rest.join(" ") || undefined;
  }
  put({ kind: "release", ref: a[0], text });
  console.log(`released ${a[0]}`);
};

export const cmdSynced = (a: string[]) => {
  // mem synced [path.md ...] — declare the spec now matches the log (none given = every spec the log mentions)
  const specs = a.length
    ? a
    : [
        ...new Set(
          rows()
            .filter((r) => r.kind === "synced" || ("spec" in r && r.spec))
            .map((r) => ("spec" in r ? r.spec : undefined))
            .filter(Boolean) as string[],
        ),
      ];
  for (const spec of specs) put({ kind: "synced", spec });
  console.log(`synced ${specs.length} spec`);
};

export const cmdHook = async () => {
  // PostToolUse: stdin = {tool_input:{file_path}} → editing this app's spec is done = mark synced automatically
  const j = (await Bun.stdin.json().catch(() => null)) as Record<
    string,
    unknown
  > | null;
  const f =
    j && typeof j === "object" && "tool_input" in j
      ? ((j as { tool_input?: { file_path?: string } }).tool_input?.file_path ??
        "")
      : "";
  const { planDir, doneDir } = await import("../store.js");
  const relF = f.startsWith(root) ? f.slice(root.length + 1) : f;
  // match PLAN*.md under this project's plan/ or done/
  const planRe = new RegExp(
    `^${planDir.replace(`${root}/`, "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}/.*PLAN.*\\.md$`,
  );
  const doneRe = new RegExp(
    `^${doneDir.replace(`${root}/`, "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}/.*PLAN.*\\.md$`,
  );
  if (planRe.test(relF) || doneRe.test(relF)) {
    put({ kind: "synced", spec: relF });
    console.log(`synced ${relF}`);
  }
};
