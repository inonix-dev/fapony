# Security Policy

## Reporting a Vulnerability

If you discover a security vulnerability in fapony, please report it responsibly.

**Do not open a public GitHub issue for security vulnerabilities.**

Instead, use GitHub's private vulnerability reporting: [Report a vulnerability](https://github.com/kire21b/fapony/security/advisories/new).

## Scope

fapony is an MCP server plus CLI that runs locally. It does not expose network services. The primary security concerns are:

- **Command injection** — fapony spawns shell commands from config (memory adapter, `install`, and the evidence collector's `.fapony/evidence.json` allowlist). `assertSafe()` deny-lists dangerous git commands (`reset --hard`, `clean -f`, `checkout --`, `git stash`), but always verify before running untrusted configs.
- **Path traversal** — fapony must not write files into the target worktree. DB lives in `~/.config/fapony/` only.
- **Memory claims** — memory commands are executed via shell adapter. Ensure memory scripts are trusted.
- **Evidence collector** — only runs commands listed in `.fapony/evidence.json`; commands an agent proposes outside that allowlist are reported as *proposed — not executed*, never run.

## Supported Versions

| Version | Supported |
|---------|-----------|
| 0.1.x   | Yes       |

## Best Practices

- Keep `fapony.config.json` out of version control (it is per-machine and gitignored) and never commit secrets
- Review `.fapony/evidence.json` before trusting a report from a repo you did not write — it is the only list of commands fapony will execute
