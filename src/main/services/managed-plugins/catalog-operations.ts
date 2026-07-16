import type {
  ManagedPluginCatalogRow,
  ManagedPluginCatalogSnapshot,
  ManagedPluginInstallIndex,
  ManagedPluginInstallIndexEntry,
} from "@shared/contracts/managed-plugin.ts";
import type { OperationsContext } from "./install-operations.ts";
import { selectNewestVersion } from "./version.ts";

/**
 * Read-only catalog derivations. Extracted from install-operations.ts to keep
 * that file under the file-size hard cap.
 */

export async function performListCatalogSnapshot(
  ctx: OperationsContext
): Promise<ManagedPluginCatalogSnapshot> {
  const state = ctx.store.get();
  const officialIndex = ctx.officialIndexProvider();
  const plugins: ManagedPluginCatalogRow[] = [];
  const seen = new Set<string>();
  for (const [pluginId, entry] of Object.entries(state.plugins)) {
    seen.add(pluginId);
    const source =
      entry.source.kind === "devOverride" ? "devOverride" : "official";
    const officialEntry = officialIndex?.plugins[pluginId];
    const bundled = ctx.bundledPlugins.find((b) => b.id === pluginId);
    const newestAvailableVersion = selectNewestVersion([
      officialEntry?.latest,
      bundled?.version,
    ]);
    // `update` doubles as "target version for the primary action". When a plugin
    // is uninstalled but bundled, its available install version is the bundled one.
    const updateAvailable = ((): { version: string } | null => {
      if (
        newestAvailableVersion &&
        entry.activeVersion &&
        selectNewestVersion([newestAvailableVersion, entry.activeVersion]) ===
          newestAvailableVersion &&
        newestAvailableVersion !== entry.activeVersion &&
        !entry.pendingRestart
      ) {
        return { version: newestAvailableVersion };
      }
      if (!entry.activeVersion && newestAvailableVersion) {
        return { version: newestAvailableVersion };
      }
      return null;
    })();
    plugins.push({
      desired: {
        enabled: entry.enabled,
        source,
        version: entry.activeVersion,
      },
      contributionCounts: bundled?.contributionCounts,
      diagnostics: [],
      description: bundled?.description,
      displayName:
        officialEntry?.displayName ?? bundled?.displayName ?? pluginId,
      ...(officialEntry?.locales || bundled?.locales
        ? {
            locales: officialEntry?.locales ?? bundled?.locales,
          }
        : {}),
      effective: entry.effectiveAtStartup
        ? {
            enabled: entry.effectiveAtStartup.enabled,
            source:
              entry.effectiveAtStartup.sourceKind === "devOverride"
                ? "devOverride"
                : "official",
            version: entry.effectiveAtStartup.version,
          }
        : null,
      id: pluginId,
      installed: entry.activeVersion !== null,
      lastKnownGoodVersion: entry.lastKnownGoodVersion ?? null,
      offlineRestoreAvailable: false,
      pendingRestart: entry.pendingRestart,
      update: updateAvailable,
    });
  }
  if (officialIndex) {
    for (const [id, officialEntry] of Object.entries(officialIndex.plugins)) {
      if (seen.has(id)) {
        continue;
      }
      seen.add(id);
      const bundled = ctx.bundledPlugins.find((entry) => entry.id === id);
      const newestAvailableVersion =
        selectNewestVersion([officialEntry.latest, bundled?.version]) ??
        officialEntry.latest;
      plugins.push({
        desired: { enabled: false, source: "official", version: null },
        ...(bundled ? { contributionCounts: bundled.contributionCounts } : {}),
        diagnostics: [],
        ...(bundled?.description ? { description: bundled.description } : {}),
        displayName: officialEntry.displayName ?? bundled?.displayName ?? id,
        ...(officialEntry.locales || bundled?.locales
          ? { locales: officialEntry.locales ?? bundled?.locales }
          : {}),
        effective: null,
        id,
        installed: false,
        lastKnownGoodVersion: null,
        offlineRestoreAvailable: false,
        pendingRestart: null,
        update: { version: newestAvailableVersion },
      });
    }
  }
  // Bundled but not yet installed — user must click Install.
  for (const bundled of ctx.bundledPlugins) {
    if (seen.has(bundled.id)) {
      continue;
    }
    plugins.push({
      desired: { enabled: false, source: "official", version: null },
      contributionCounts: bundled.contributionCounts,
      diagnostics: [],
      description: bundled.description,
      displayName: bundled.displayName,
      ...(bundled.locales ? { locales: bundled.locales } : {}),
      effective: null,
      id: bundled.id,
      installed: false,
      lastKnownGoodVersion: null,
      offlineRestoreAvailable: false,
      pendingRestart: null,
      update: { version: bundled.version },
    });
  }
  const pluginMode = ctx.pluginMode ?? "release";
  const officialMutationsAllowed = pluginMode === "release";
  return {
    checkedAt: ctx.now(),
    officialMutationsAllowed,
    pluginMode,
    plugins,
  };
}

export function computeSimulateRestartMutation(
  state: ManagedPluginInstallIndex,
  isDevRuntime: boolean
): ManagedPluginInstallIndex {
  const nextPlugins: Record<string, ManagedPluginInstallIndexEntry> = {};
  for (const [pluginId, entry] of Object.entries(state.plugins)) {
    if (entry.activeVersion === null) {
      nextPlugins[pluginId] = {
        ...entry,
        effectiveAtStartup: null,
        pendingRestart: null,
      };
      continue;
    }
    const useDevOverride = Boolean(entry.devOverride) && isDevRuntime;
    const sourceKind: "official" | "devOverride" = useDevOverride
      ? "devOverride"
      : "official";
    const effectiveVersion = useDevOverride
      ? (entry.devOverride?.version ?? entry.activeVersion)
      : entry.activeVersion;
    if (effectiveVersion === null) {
      nextPlugins[pluginId] = {
        ...entry,
        effectiveAtStartup: null,
        pendingRestart: null,
      };
      continue;
    }
    nextPlugins[pluginId] = {
      ...entry,
      effectiveAtStartup: {
        enabled: entry.enabled,
        sourceKind,
        version: effectiveVersion,
      },
      pendingRestart: null,
    };
  }
  return { ...state, plugins: nextPlugins };
}
