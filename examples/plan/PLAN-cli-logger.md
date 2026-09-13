# PLAN-cli-logger — structured JSON logger for CLI tools

> **Status:** 🚧 in-progress · **Owner:** delamind · **Created:** 2026-09-05
>
> **This example has no frontmatter and no TL;DR on purpose.** It is what a plan written before
> either existed looks like, and it is still a first-class citizen: `plan_list` groups it from
> fapony's run history alone — attempted means `active`, never attempted means `untouched`. You
> do not have to annotate a folder of old plans before the tool is useful. Add the header to a
> plan when you next touch it, or never.

## 1. Goal (why)

CLI output is `console.log` strings today, so nothing downstream can filter it. A structured
logger writing one JSON object per line makes the same output greppable, and lets a CI job pull
out just the failures.

## 2. Scope (do / don't do)

**Do:**
- `log.info/warn/error/debug(msg, fields?)`
- One JSON object per line on stdout: `{ ts, level, msg, ...fields }`
- Level threshold from `LOG_LEVEL`, defaulting to `info`
- Pretty, colorized output when stdout is a TTY

**Don't do:**
- No file transport, no rotation — the shell redirects better than we would
- No remote sinks
- No child-logger hierarchy until something needs it

## 3. Done criteria (how we know it's finished)

- `LOG_LEVEL=debug` prints debug lines; the default does not
- Piped output is one valid JSON object per line — `| jq -c .` succeeds on every line
- TTY output is human-readable and colorized
- An `Error` field serializes with its message and stack, not as `{}`
- `npm run typecheck` passes

## 4. Constraints / Hard rules (must not violate)

- Zero dependencies — `JSON.stringify` and `process.stdout.write` are the whole implementation
- Never throw from a log call; a logger that can crash the tool is worse than no logger
- Never write to stdout when the level is below threshold (a discarded line still costs a syscall)
- No global mutable logger state beyond the threshold read once at startup

## 5. Risks & Escape hatches (if it fails)

| Risk | Likelihood | Impact | Escape hatch |
|---|---|---|---|
| Circular object in `fields` throws | medium | crashes the tool mid-run | `try/catch` around stringify, fall back to `String(value)` |
| Interleaved partial lines on concurrent writes | low | broken JSON in the pipe | one `write()` per line, never per fragment |
| TTY detection wrong in CI | medium | color codes in log files | `process.stdout.isTTY` only, no terminal sniffing |

## 6. Steps (what in which order)

1. **Core writer** — level check, serialize, one `write()` · verify: unit test asserts one line per call
2. **Error serialization** — message + stack + name · verify: test that an `Error` field round-trips
3. **TTY formatter** — colorized when `isTTY` · verify: manual run in a terminal and piped to `jq`
4. **Threshold** — read `LOG_LEVEL` once · verify: test each level pair

## 7. Examples (make it concrete)

```bash
$ my-cli build | jq -c 'select(.level == "error")'
{"ts":"2026-09-05T10:00:03.412Z","level":"error","msg":"build failed","file":"src/index.ts"}
```

## 8. References

- [templates/PLAN.md](../../templates/PLAN.md) — the template this follows
