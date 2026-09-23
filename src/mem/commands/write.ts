// commands/write.ts — mutating commands: add, close, claim, release, synced, hook

import { CapError, engineAdd, engineClose } from "../engine.js";
import { claimsOf, openRows } from "../selectors.js";
import type { WorkKind } from "../store.js";
import { KINDS, memCmd, put, root, rows } from "../store.js";

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

  // Positional reparse (PLAN-comma-x chunk 2): walk argv once, consume every
  // known flag occurrence, keep the rest as positional = text + optional
  // trailing spec.md. The old filter removed only the first --files value by
  // identity, so `--files a --files b` left the stray `b` in the row text
  // (live corruption, row muds6zg5) — and a text word equal to the files
  // value was eaten instead. Flag strip stays positional, never by value:
  // a key like "fix" may legitimately sit inside the text.
  const positional: string[] = [];
  const rawFiles: string[] = [];
  let filesValueMissing = false;
  let useStdin = false;
  let sawKey = false;
  let keyVal: string | undefined;
  const rest = a.slice(1);
  for (let i = 0; i < rest.length; i++) {
    const t = rest[i];
    if (t === "--stdin") {
      useStdin = true;
      continue;
    }
    if (t === "--files") {
      const v = rest[i + 1];
      if (v !== undefined && !v.startsWith("--")) {
        rawFiles.push(v);
        i++;
      } else {
        filesValueMissing = true; // dies in validation below
      }
      continue;
    }
    if (t === "--key" || t.startsWith("--key=")) {
      const eq = t.startsWith("--key=");
      const v = eq ? t.slice("--key=".length) : rest[i + 1];
      if (!sawKey) {
        sawKey = true;
        keyVal = v; // first occurrence wins — validated below
      }
      // Consume the value token on every occurrence so a stray repeat never
      // leaks into the text (same leak class as a repeated --files).
      if (!eq && v !== undefined && !v.startsWith("--")) i++;
      continue;
    }
    positional.push(t);
  }

  // Validation order unchanged from the old parser: files → key → hold → text.
  if (filesValueMissing || rawFiles.length === 0) {
    console.error(
      `--files is required — usage: ${memCmd} add ${a[0]} "<text>" --files path/to/file.ts[,more] [spec.md]`,
    );
    process.exit(1);
  }
  const files: string[] = [];
  for (const v of rawFiles) {
    const parts = v
      .split(",")
      .map((s) => s.trim().replace(/^\.\//, ""))
      .filter(Boolean);
    if (parts.length === 0) {
      console.error(
        `--files needs at least one path — usage: ${memCmd} add ${a[0]} "<text>" --files path/to/file.ts[,more]`,
      );
      process.exit(1);
    }
    files.push(...parts);
  }
  // --key is optional; pattern validation lives in engineAdd (one checker,
  // both surfaces — PLAN-mem-keys chunk 1). argv layer only extracts it.
  // Accepts `--key value` and `--key=value` alike (same as cmdFind) — an
  // exact-match lookup for "--key" would leave a `--key=x` token inside the
  // text and write a keyless row with exit 0 (silent drop, never allowed).
  if (sawKey && (!keyVal || keyVal.startsWith("--"))) {
    console.error(
      `--key needs a value — usage: ${memCmd} add ${a[0]} "<text>" --files f1,f2 --key fix-stop-dedupe`,
    );
    process.exit(1);
  }
  const spec = positional.at(-1)?.endsWith(".md")
    ? positional.pop()
    : undefined;
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
    if (positional.length === 0) {
      console.error(
        `text is required — usage: ${memCmd} add <kind> "<text>" --files f1,f2 [spec.md]`,
      );
      process.exit(1);
    }
    text = positional.join(" ");
  }
  // Domain rules (caps, id) live in the shared engine — this wrapper owns
  // only argv surface and the MEM_FORCE hint wording (PLAN-unify-mem-engine).
  try {
    const { id } = engineAdd({ kind: a[0], text, spec, files, key: keyVal });
    console.log(id);
  } catch (e) {
    if (e instanceof CapError) {
      const hint =
        e.cap === "next"
          ? " (or MEM_FORCE=1 if you really must)"
          : " (or MEM_FORCE=1)";
      console.error(`${e.message}${hint}`);
    } else {
      console.error(e instanceof Error ? e.message : String(e));
    }
    process.exit(1);
  }
};

export const cmdClose = async (a: string[]) => {
  // mem close <id> "<what was done / commit>" — the tombstone voids the claim by itself
  // mem close <id> --stdin ← read text from stdin
  if (!a[0]) {
    console.error(`id is required — usage: ${memCmd} close <id> "<text>"`);
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
  // Tombstone rules (id must exist, text required) live in the shared engine —
  // note this tightens CLI: an empty-text close now errors instead of writing
  // a textless tombstone (intentional, PLAN-unify-mem-engine §4).
  try {
    engineClose({ id: a[0], text });
  } catch (e) {
    console.error(e instanceof Error ? e.message : String(e));
    process.exit(1);
  }
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
