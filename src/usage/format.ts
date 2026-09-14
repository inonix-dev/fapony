// src/usage/format.ts — pure formatting helpers for usage-web

export { esc } from "../web/html.js";

export function fmtTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}K`;
  return String(Math.round(n));
}

export function fmtCost(n: number | null): string {
  return n !== null && n > 0 ? `~$${n.toFixed(4)}` : "—";
}

export function fmtDelta(prev: number, curr: number): string {
  const d = curr - prev;
  if (d === 0) return "";
  return d > 0 ? `+${d.toLocaleString()}` : d.toLocaleString();
}

export function shortModel(raw: string): string {
  try {
    const obj = JSON.parse(raw);
    if (obj && typeof obj === "object" && typeof obj.id === "string") {
      return obj.id;
    }
  } catch {}
  return raw;
}
