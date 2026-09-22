// src/debt/format.ts — report rendering: zone grouping + text output.

import { dirname } from "node:path";
import { type DebtReport, ZONE_CAP, ZONE_DEPTH } from "./debt-types.js";

/** The zone of a file: its directory path, capped at `depth` segments. */
function zoneOf(file: string, depth: number): string {
  const parts = dirname(file)
    .split("/")
    .filter((p) => p && p !== ".");
  return parts.slice(0, depth).join("/") || ".";
}

/** Group files by their directory zone (see `zoneOf`). */
function groupFilesByZone(
  files: string[],
  depth: number,
): Map<string, string[]> {
  const zones = new Map<string, string[]>();
  for (const f of files) {
    const zone = zoneOf(f, depth);
    const cur = zones.get(zone) ?? [];
    cur.push(f);
    zones.set(zone, cur);
  }
  // Sort zones by file count descending, then alphabetically
  return new Map(
    [...zones.entries()].sort((a, b) => {
      const d = b[1].length - a[1].length;
      return d !== 0 ? d : a[0].localeCompare(b[0]);
    }),
  );
}

/** Escape a regex source for use in a shell grep command. */
function shellEscapeRe(src: string): string {
  return src.replace(/'/g, "'\\''");
}

export function formatDebt(report: DebtReport, showAll = false): string {
  const lines: string[] = [];
  lines.push(
    `fapony debt — ${report.entries.length + report.declared.length + report.checkedCount} convention(s), ` +
      `${report.scannedFiles} files scanned, ${report.ms}ms — derived fresh, not stored`,
  );
  for (const e of report.entries) {
    const moved =
      e.movedCount !== null && e.files.length > 0
        ? ` · moved ${e.movedCount} (${Math.round((e.movedCount / (e.files.length + e.movedCount)) * 100)}%)`
        : e.movedCount !== null
          ? ` · moved ${e.movedCount}`
          : "";
    lines.push(`\n${e.conv.id} — ${e.conv.rule}`);
    // Show the patterns actually used
    const patterns: string[] = [];
    if (e.conv.stale) patterns.push(`stale: ${e.conv.stale}`);
    if (e.conv.ok) patterns.push(`ok: ${e.conv.ok}`);
    if (e.conv.guard) patterns.push(`guard: ${e.conv.guard}`);
    patterns.push(`where ${e.conv.where}`);
    lines.push(`  ${patterns.join("  ·  ")}`);
    if (e.files.length === 0) {
      lines.push(`  debt 0${moved} — clean`);
      continue;
    }
    lines.push(`  debt ${e.files.length}${moved}`);
    // Verify command derived from stale
    if (e.conv.stale) {
      lines.push(`  verify: grep -rn '${shellEscapeRe(e.conv.stale)}' <zone>`);
    }
    // Zone grouping
    const zones = groupFilesByZone(e.files, ZONE_DEPTH);
    const zoneEntries = [...zones.entries()];
    const cap = showAll
      ? zoneEntries.length
      : Math.min(zoneEntries.length, ZONE_CAP);
    let totalCapped = 0;
    for (let i = 0; i < cap; i++) {
      const [zone, zoneFiles] = zoneEntries[i];
      const pad = " ".repeat(Math.max(0, 42 - zone.length));
      lines.push(`\n  ${zone}${pad}${zoneFiles.length} ไฟล์`);
      lines.push(`    ${zoneFiles.map((f) => f.split("/").pop()).join(" · ")}`);
      totalCapped += zoneFiles.length;
    }
    if (zoneEntries.length > cap) {
      const remaining = e.files.length - totalCapped;
      const remainingZones = zoneEntries.length - cap;
      lines.push(
        `\n  … อีก ${remainingZones} โซน (${remaining} ไฟล์) — fapony debt --id ${e.conv.id} --all`,
      );
    }
  }
  for (const c of report.declared) {
    lines.push(`\n${c.id} — ${c.rule} (where ${c.where})`);
    lines.push(
      `  declared, no checker, stale not filled in — fill "stale" in conventions.json`,
    );
  }
  if (report.checkedCount > 0) {
    lines.push(
      `\n${report.checkedCount} convention(s) have a checker — fapony stays silent, the checker reports`,
    );
  }
  for (const d of report.dropped) {
    lines.push(`⚠ ${d.id}: ${d.reason}`);
  }
  return lines.join("\n");
}
