---
name: define-convention
description: Turn "files that haven't migrated yet" into a tracked convention — one question, a draft built from real examples, then dry-run fapony debt until the counts hold. Trigger on /define-convention and when the user wants migration tracking or fapony debt shows declared rows with no regex.
---

# Define Convention — from pain to a counted migration

One convention = the pattern to use (`ok`) + the pattern meaning not-yet-migrated
(`stale`) + scope (`where`) + an optional file condition (`guard`). The output is
one row in `<worktree>/.fapony/conventions.json` (`{"conventions": [...]}`), in the
same `.fapony/` dir as the mem log — run `fapony mem where`, go up one level, that
is where the file lives (app-scoped in a monorepo). No file there yet = create it;
a file with rows = append only, never rewrite other rows.

## Phase 1 — One question, then the checker question

Ask this, and nothing else:

> "What should stop appearing, and what does the migrated code look like? Which
> directory is it in?"

Then the iron-rule question (one line, always asked — a convention eslint already
flags is one fapony must stay silent on):

> "Does an eslint rule or script already flag the old pattern? If yes, name it —
> fapony will record it as `checker` and never report this debt."

## Phase 2 — Real examples before regex

Never invent the regex from prose — regex from prose is how entries get dropped.
`grep` the `where` dir for 2–3 hits of the old pattern and 1–2 of the new one. No
hits on either side = stop and say so; there is no migration to track yet, only
an opinion.

## Phase 3 — Draft the row, show it, append it

```json
{"id": "raw-throw", "rule": "throw failWith, not raw Error",
 "where": "src", "stale": "throw new Error", "ok": "failWith"}
```

- `id` short, kebab; `rule` one human line; `where` a repo-relative dir that
  exists (`"."` = whole repo).
- `guard` only when `stale` alone is too broad (the file must ALSO match, e.g.
  `"extends Base"`).
- `checker` set from Phase 1 = silent by design; verify it with eslint, not fapony.
- `stale: null` ships a `declared` placeholder — fill it or delete it, never keep it.
- The shown draft is the confirmation (rule 6c). Append, don't rewrite.

## Phase 4 — Dry-run until the counts hold

```bash
fapony debt --id <new-id>
```

Read it literally — every outcome names its fix:

- `debt N · moved M` with N > 0 → the convention now counts. Report id, N, moved%
  back in chat.
- `debt 0 · moved M — clean` → the migration is already done; nothing left to
  track. Report it and change nothing.
- `debt 0` with no moved → `stale` matches nothing you care about; widen it or
  fix `where`.
- `⚠ <id>: ... too broad` → narrow `stale`, shrink `where`, or add `guard` (the
  match was capped past 250 files, so the entry was dropped).
- `⚠ <id>: stale regex broken` / `where: <dir> does not exist` → fix syntax / path.
- A row prints `declared, no checker, stale not filled in` → `stale` is null; see
  Phase 3.
- `0 convention(s)` after `--id` → that id does not exist (misspelling — a dropped
  row still prints its `⚠`). Only `no conventions.json in <dir>` means you wrote
  to the wrong `.fapony/` (re-check `mem where`).

## Later

A convention whose fix recurs ≥3 times makes `fapony debt` ask "time for a
checker?" — that promotion answers to a human, never to this skill. `no-checker`
means "never ask again": say it only deliberately.
