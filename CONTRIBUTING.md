# Contributing to fapony

Thanks for your interest in contributing!

## Development Setup

```bash
# clone the repo
git clone https://github.com/kire21b/fapony.git
cd fapony

# install dependencies
bun install

# run all checks (lint + typecheck + test)
bun run check
```

## Before Submitting

1. **Run checks** — `bun run check` must pass (lint, typecheck, test)
2. **Commit conventions** — use conventional commits: `feat:`, `fix:`, `chore:`, `docs:`, `refactor:`, `test:`
3. **One concern per commit** — keep commits focused

## Project Rules

- **Dependencies are allowed — but they must not reach `fapony mcp` startup** — every MCP client
  launches that server on every session, and `fapony.ts` static-imports every module, so anything
  new is `await import()`ed on the CLI path that needs it. Budget: the `initialize` round trip
  stays under ~100ms (63ms as of 2026-09-17)
- **No abstraction for abstraction's sake** — don't scaffold for a future that may not come
- **No git push** — push is done manually after review
- **fapony must not write files into the target worktree** — DB lives in `~/.config/fapony/` only
- **assertSafe() must be called on every command** before spawn, including config-sourced ones

## Running Tests

```bash
bun fapony.ts test
```

## Code Style

- Biome for linting and formatting (`bun run lint`)
- TypeScript strict mode
- No comments unless asked
