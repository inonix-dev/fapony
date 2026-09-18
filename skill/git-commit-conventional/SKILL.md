---
name: git-commit-conventional
description: Commit split by concern with conventional message — use with Claude Code / OpenCode / Codex / ZCode. Trigger on /git-commit and when the user asks to commit changes.
---

# Git Commit Conventional — split by concern

**Hard rule: 1 commit per concern.** Never bundle unrelated changes.

Splitting is not only for the reader: a repo whose commits each carry one concern is the
only kind whose history can be mined for convention migrations (a commit that deletes
`A(` and adds `B(` is evidence that `B` replaced `A`). Measured on a real repo
2026-09-18: restricting the mine to commits touching 10+ files erased every real
convention it had found, and loosening the matcher to compensate produced only noise.
Bundled commits destroy that signal permanently — history cannot be re-split later.

## Before commit

1. `git status --porcelain` — in a shared/multi-agent worktree (fapony's `wt-*`), files already
   dirty before this session started are another session's in-progress work, not a problem.
   STOP and report only if a file changes between two consecutive `git status` calls (someone is
   writing right now — wait for it to settle), or if content matches nothing in this
   conversation and doesn't look like a coherent feature.
2. `git diff --stat HEAD` — see what changed
3. Split by type — `feat` `fix` `refactor` `docs` `chore` `test` — one commit each.
   `git add -p` is unavailable here (interactive flags unsupported), so split at file
   granularity. If one file mixes your work with someone else's, put it with the concern it
   mostly belongs to and say so in the body — don't force a line-level split you can't do safely.

## Format

```
<type>(<scope>): <subject, max 72 chars>

<body — what changed and why, wrapped at 76>

Ref <PLAN-file, if any>

Co-Authored-By: <the model you are running as> <its vendor's noreply address>
```

If your harness already gave you an exact `Co-Authored-By` line, use that verbatim — it wins over
this template. Otherwise name the model you actually are; never copy another vendor's address.

`<type>` is exactly one of the six words above — no `feat/fix:`, no two-word types.

### Example

```
feat(analyze): structural health diagnosis

Reports hub / orphan / cycle / changed-untested files from an import
graph built live with Bun.Transpiler.scan(). Nothing persisted: 114
files scan in 16.6ms, so a cache table would be pure debt.

Ref PLAN-analyze.md
```

## Rules

- **NEVER push from this skill** — it only commits. Push/PR/merge is [git-ship](../git-ship/SKILL.md)'s job
- **Report in lines, not paragraphs** — what you did, what needs the user, nothing else. Never
  narrate the steps; the commands are already in the transcript.
- **NEVER `--amend`** an existing commit unless explicitly authorized
- **NEVER `--no-verify`** — if a pre-commit hook (lint/typecheck) fails on pre-existing code you
  didn't write, fix it for real (safe autofix + minimal manual fix) and note in the body that
  the fix wasn't for your own change
- Conflict with the base branch → STOP and report, don't merge yourself
