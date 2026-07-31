import type { PluginRegistryEntry } from "@shared/contracts/plugin.ts";
import { describe, expect, it } from "vitest";
import type { CatalogRow } from "@/pages/settings/components/managed-plugin-rows.tsx";
import {
  catalogRowName,
  sortUnifiedRows,
  type UnifiedRow,
} from "@/pages/settings/components/plugin-list-order.ts";

function registryEntry(
  id: string,
  name: string,
  locales?: Record<string, { name?: string }>
): PluginRegistryEntry {
  return {
    effectivePermissions: [],
    enabled: true,
    manifest: {
      apiVersion: 1,
      commands: [],
      id,
      name,
      panels: [],
      permissions: [],
      publisher: "Pier",
      settingsPages: [],
      terminalStatusItems: [],
      version: "1.0.0",
      workbenchWidgets: [],
      ...(locales ? { locales } : {}),
    } as unknown as PluginRegistryEntry["manifest"],
    runtime: { canToggle: true, enabled: true, kind: "external" },
  } as unknown as PluginRegistryEntry;
}

function catalogRow(
  id: string,
  displayName: string,
  overrides: Partial<CatalogRow> = {}
): CatalogRow {
  return {
    desired: { enabled: true, source: "official", version: "1.0.0" },
    diagnostics: [],
    displayName,
    effective: { enabled: true, source: "official", version: "1.0.0" },
    id,
    installed: true,
    lastKnownGoodVersion: null,
    offlineRestoreAvailable: false,
    pendingRestart: null,
    update: null,
    ...overrides,
  } as CatalogRow;
}

function entryRow(
  id: string,
  name: string,
  managedRow: CatalogRow | null = null
): UnifiedRow {
  return { kind: "entry", entry: registryEntry(id, name), managedRow };
}

describe("plugin list order", () => {
  it("sorts alphabetically by display name, not insertion order", () => {
    const rows: UnifiedRow[] = [
      entryRow("pier.codex", "Codex Account Management"),
      entryRow("pier.grok", "Grok Account Management"),
      entryRow("pier.claude", "Claude Account Management"),
    ];
    const sorted = sortUnifiedRows(rows, "en");
    expect(
      sorted.map((row) => (row.kind === "entry" ? row.entry.manifest.id : ""))
    ).toEqual(["pier.claude", "pier.codex", "pier.grok"]);
  });

  it("floats restart-pending rows to the top", () => {
    const rows: UnifiedRow[] = [
      entryRow("pier.claude", "Claude Account Management"),
      entryRow(
        "pier.grok",
        "Grok Account Management",
        catalogRow("pier.grok", "Grok Account Management", {
          pendingRestart: { kind: "update" } as CatalogRow["pendingRestart"],
        })
      ),
      { kind: "available", row: catalogRow("pier.zeta", "Zeta") },
    ];
    const sorted = sortUnifiedRows(rows, "en");
    expect(sorted[0]?.kind).toBe("entry");
    expect(sorted[0]?.kind === "entry" ? sorted[0].entry.manifest.id : "").toBe(
      "pier.grok"
    );
  });

  it("uses the locale-aware catalog name for available rows", () => {
    expect(
      catalogRowName(
        catalogRow("pier.claude", "Claude Account Management", {
          locales: {
            "zh-CN": { name: "Claude 账号管理" },
          } as CatalogRow["locales"],
        }),
        "zh-CN"
      )
    ).toBe("Claude 账号管理");
    expect(
      catalogRowName(
        catalogRow("pier.claude", "Claude Account Management"),
        "zh-CN"
      )
    ).toBe("Claude Account Management");
  });

  it("resolves registry-entry names through manifest locales", () => {
    const rows: UnifiedRow[] = [
      {
        kind: "entry",
        entry: registryEntry("pier.b", "B Plugin", {
          "zh-CN": { name: "阿尔法" },
        }),
        managedRow: null,
      },
      entryRow("pier.a", "贝塔"),
    ];
    // zh-CN: 阿尔法 (ā) sorts before 贝塔 (b) under zh collation.
    const sorted = sortUnifiedRows(rows, "zh-CN");
    expect(
      sorted.map((row) => (row.kind === "entry" ? row.entry.manifest.id : ""))
    ).toEqual(["pier.b", "pier.a"]);
  });
});
