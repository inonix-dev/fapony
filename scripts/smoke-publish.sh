#!/usr/bin/env bash
# scripts/smoke-publish.sh — prepublishOnly gate.
#
# Packs the tarball exactly as npm/pnpm would ship it, extracts it away from
# the repo (so nothing outside `files` is reachable by accident), and runs
# the CLI with no args. Bun resolves every static import in fapony.ts before
# any branch runs, so this alone reproduces the class of bug it exists to
# catch: an import that only resolves inside the repo (e.g. reaching into
# test/, which `files` deliberately excludes) breaks every command, not just
# the one that imported it. A clean run reaches the intentional
# "usage: fapony ..." exit(1) — anything else (module-not-found, a crash) is
# what this blocks on.
set -euo pipefail

dir=$(mktemp -d)
trap 'rm -rf "$dir"' EXIT

pnpm pack --silent --pack-destination "$dir" >/dev/null
tgz=$(ls "$dir"/*.tgz)
tar xzf "$tgz" -C "$dir"

out=$(cd "$dir/package" && bun fapony.ts 2>&1 || true)

if ! echo "$out" | grep -q "usage: fapony"; then
  echo "smoke-publish: packed tarball did not reach the CLI's usage line — module load broke" >&2
  echo "--- output ---" >&2
  echo "$out" >&2
  exit 1
fi

echo "smoke-publish: packed tarball loads and dispatches cleanly"
