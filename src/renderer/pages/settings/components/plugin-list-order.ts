import type { PluginRegistryEntry } from "@shared/contracts/plugin.ts";
import { resolvePluginDisplay } from "@/lib/plugins/display.ts";
import type { CatalogRow } from "./managed-plugin-rows.tsx";

/**
 * Unified plugin-list row (settings → Plugins). Declared here so the sort
 * helpers stay pure and unit-testable without mounting the section.
 */
export type UnifiedRow =
  | {
      kind: "entry";
      /** Registry entry (built-in or installed managed). */
      entry: PluginRegistryEntry;
      /** Set only when this entry is also a managed catalog row. */
      managedRow: CatalogRow | null;
    }
  | {
      kind: "available";
      row: CatalogRow;
    }
  | {
      kind: "unavailable";
      row: CatalogRow;
    };

/** Locale-aware display name for a catalog row (locales → displayName). */
export function catalogRowName(row: CatalogRow, locale: string): string {
  const shortLocale = locale.split("-")[0] ?? "";
  for (const code of [locale, shortLocale]) {
    const name = code ? row.locales?.[code]?.name : undefined;
    if (name) {
      return name;
    }
  }
  return row.displayName;
}

function rowName(row: UnifiedRow, locale: string): string {
  if (row.kind === "entry") {
    return resolvePluginDisplay(row.entry, locale).name;
  }
  return catalogRowName(row.row, locale);
}

function needsRestart(row: UnifiedRow): boolean {
  const managed = row.kind === "entry" ? row.managedRow : row.row;
  return Boolean(managed?.pendingRestart);
}

/**
 * Industry-standard plugin list order (VS Code / JetBrains convention):
 * rows with a pending user action (restart required) float to the top, the
 * rest sort alphabetically by locale-aware display name. Insertion order
 * (= first-install order) is machine-dependent and must never surface.
 */
export function sortUnifiedRows(
  rows: readonly UnifiedRow[],
  locale: string
): UnifiedRow[] {
  return [...rows].sort((a, b) => {
    const restart = Number(needsRestart(b)) - Number(needsRestart(a));
    if (restart !== 0) {
      return restart;
    }
    return rowName(a, locale).localeCompare(rowName(b, locale), locale, {
      sensitivity: "base",
    });
  });
}
