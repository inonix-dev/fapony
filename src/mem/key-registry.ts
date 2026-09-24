// src/mem/key-registry.ts — domain key registry (`domain:sub`).
//
// PLAN-mem-core chunk 4: keys an agent invents never converge (3%), so a repo
// that wants convergence declares its domains in `.fapony/keys.json`, beside
// `conventions.json` — fixed path, no config field (rule: never add a field
// derivable from structure). No file = keys stay free-form (never reject);
// a file = the domain half must be listed, the sub half stays free.
//
// Shape: {"domains": ["auth", "hook"]} (a bare ["auth"] array reads the same).

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { FAPONY_DIR, KEYS_FILE, KEYS_FILENAME } from "../core/config.js";
import { KEY_SEGMENT_RE } from "../core/mem-log.js";
import { resolveMemDir } from "../memory.js";

/** Split `domain:sub` — null domain = a bare legacy key, always allowed. */
export function splitKey(key: string): { domain: string; sub: string } | null {
  const i = key.indexOf(":");
  if (i < 0) return null;
  return { domain: key.slice(0, i), sub: key.slice(i + 1) };
}

/**
 * A bare domain query doubles as a prefix: `auth` matches the exact key
 * `auth` and every `auth:*`. A query carrying a colon is an exact match —
 * `auth:login` never pulls in `auth:logout`.
 */
export function keyMatchesQuery(
  rowKey: string | undefined,
  query: string,
): boolean {
  if (!rowKey) return false;
  if (query.includes(":")) return rowKey === query;
  return rowKey === query || rowKey.startsWith(`${query}:`);
}

export function resolveKeysPath(worktree: string): string | null {
  // Same anchor as conventions.json: the .fapony/ dir holding the mem log,
  // so the registry and the log cannot drift apart.
  const memDir = resolveMemDir(worktree);
  const base = memDir ? join(memDir, "..") : join(worktree, FAPONY_DIR);
  const app = join(base, KEYS_FILENAME);
  if (existsSync(app)) return app;
  const root = join(worktree, KEYS_FILE);
  return existsSync(root) ? root : null;
}

export interface KeyRegistry {
  path: string | null;
  /** Sorted, deduped, segment-valid — the list reject messages print. */
  domains: string[];
  warnings: string[];
}

/** Missing file = empty + no error (same contract as conventions.json). */
export function loadKeyRegistry(worktree: string): KeyRegistry {
  const path = resolveKeysPath(worktree);
  if (!path) return { path: null, domains: [], warnings: [] };
  let raw: string;
  try {
    raw = readFileSync(path, "utf-8");
  } catch {
    return { path, domains: [], warnings: [`keys.json unreadable: ${path}`] };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    return {
      path,
      domains: [],
      warnings: [
        `keys.json is not valid JSON — ${
          e instanceof Error ? e.message.split("\n")[0] : "parse error"
        }`,
      ],
    };
  }
  const rows: unknown[] = Array.isArray(parsed)
    ? parsed
    : Array.isArray((parsed as { domains?: unknown }).domains)
      ? (parsed as { domains: unknown[] }).domains
      : [];
  const seen = new Set<string>();
  let dropped = 0;
  for (const r of rows) {
    if (typeof r === "string" && KEY_SEGMENT_RE.test(r)) seen.add(r);
    else dropped++;
  }
  const warnings =
    dropped > 0
      ? [
          `keys.json: ${dropped} entr${dropped === 1 ? "y" : "ies"} dropped (not [a-z0-9-]{3,40})`,
        ]
      : [];
  return { path, domains: [...seen].sort(), warnings };
}

/**
 * null domains = no registry on disk = free-form keys (never reject).
 * A registry gates only the domain half; bare keys stay backward compatible.
 */
export function checkKeyDomain(
  key: string,
  domains: string[] | null | undefined,
): string | null {
  if (domains == null) return null;
  const split = splitKey(key);
  if (!split) return null;
  if (domains.includes(split.domain)) return null;
  return (
    `unknown key domain "${split.domain}" — known domains: ` +
    (domains.length ? domains.join(", ") : "(none yet)")
  );
}
