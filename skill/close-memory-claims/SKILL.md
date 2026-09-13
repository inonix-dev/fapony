---
name: close-memory-claims
description: Close or release every memory entry you claimed before the session ends, so the log never lies to the next agent. Trigger on /close-memory-claims and at the end of any session in a repo that has .fapony/.memory/mem.ts.
---

# Close your claims before the session ends

Applies only to repos that have `.fapony/.memory/mem.ts` (scaffolded by `fapony init`).
No such file, nothing to do — say so in one line and stop.

## The rule

Before ending the session, run:

```bash
bun .fapony/.memory/mem.ts now
```

Look for entries **you claimed during this session** that are still listed as open. For each one:

1. **Work finished** — `bun .fapony/.memory/mem.ts close <id> "what was done"`
2. **Work partly done** — `close` the current id, then `add next "<what remains>"`.
   Do not leave the old stale `next` sitting alongside a new one.
3. **Work not started** — `bun .fapony/.memory/mem.ts release <id> "reason"`

Leaving a claim open means it lies to every future session: the next agent reads it as
"still to do" and may duplicate or contradict work that is already done. Closing is a hard
requirement, not optional cleanup.

Do not skip this even if the session was short or you only read files. If you claimed an id,
you own it until it is closed.

## Writing the message

The close message is read months later by someone with no access to this conversation.
Write it standalone: what the work was and how it ended, plus commit shas when they exist.
"done" and "fixed it" are worthless; `"xlsx writer + format param, wired 5 pages (a027a1c)"`
is not.

## What this is not

This is not `verdict_submit`. The memory log is prose for the next agent — what is in
flight, what was decided, what broke. A verdict is a graded unit of work, queried later by
model and task shape. Both, or neither, but never one instead of the other.
