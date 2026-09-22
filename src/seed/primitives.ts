// src/seed/primitives.ts — shared helpers for plan-seed + review-seed
//
// Git execution, output capping, signature formatting — the pieces both
// commands need. §0 rule: add-only — never remove or rename exported symbols.

import { execSync } from "node:child_process";

// --- Error class ---

export class SeedError extends Error {}

// --- Git helpers ---

export function execGit(
  cmd: string,
  cwd: string,
): { ok: boolean; output: string; error?: string } {
  try {
    const output = execSync(cmd, {
      cwd,
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
      timeout: 15_000,
    });
    return { ok: true, output: output.trim() };
  } catch (e: unknown) {
    const err = e as { stderr?: string; message?: string };
    return {
      ok: false,
      output: "",
      error: (err.stderr ?? err.message ?? "").trim(),
    };
  }
}

export function gitOk(r: { ok: boolean; error?: string }, cmd: string): void {
  if (!r.ok)
    throw new SeedError(`git failed: ${cmd}\n${r.error ?? "unknown error"}`);
}

// Values interpolated into a git command line must be plain refs/paths —
// blocks shell metacharacters before execSync ever sees them.
const GIT_VALUE_RE = /^[A-Za-z0-9._/{}^~+-]+$/;

export function gitValue(kind: string, value: string): string {
  if (!GIT_VALUE_RE.test(value)) {
    throw new SeedError(`invalid ${kind}: ${value}`);
  }
  return value;
}

// --- Output capping ---

// Keep the head, always say how much was cut — a silent cut is
// indistinguishable from "that was everything".
export { capLines } from "../core/util.js";

// --- Signature formatting ---

export const SIG_MAX = 90;
