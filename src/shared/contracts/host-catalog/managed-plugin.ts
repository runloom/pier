import {
  type ManagedPluginCatalogSnapshot,
  managedPluginCatalogRowSchema,
  managedPluginCatalogSnapshotSchema,
} from "../plugin/managed.ts";
import type { CatalogDomainSnapshot, CatalogItem } from "./runtime.ts";

export const MANAGED_PLUGIN_META_ID = "__managed-plugin-meta";

const metaSchema = managedPluginCatalogSnapshotSchema.omit({ plugins: true });

export function managedPluginCatalogToItems(
  catalog: ManagedPluginCatalogSnapshot
): CatalogItem[] {
  const meta: CatalogItem = {
    details: {
      checkedAt: catalog.checkedAt,
      officialMutationsAllowed: catalog.officialMutationsAllowed,
      pluginMode: catalog.pluginMode,
    },
    domain: "managed-plugin",
    id: MANAGED_PLUGIN_META_ID,
    label: "managed-plugin",
    localVersion: null,
    presence: "present",
    remoteVersion: null,
    updateOffered: false,
  };
  const plugins = catalog.plugins.map((row): CatalogItem => {
    const localVersion = row.effective?.version ?? row.desired.version;
    const remoteVersion = row.update?.version ?? null;
    return {
      details: row,
      domain: "managed-plugin",
      id: row.id,
      label: row.displayName,
      localVersion,
      presence: row.installed ? "present" : "missing",
      remoteVersion,
      updateOffered: row.installed && remoteVersion !== null,
    };
  });
  return [meta, ...plugins];
}

export function domainToManagedPluginCatalog(
  snapshot: CatalogDomainSnapshot
): ManagedPluginCatalogSnapshot | null {
  if (snapshot.domain !== "managed-plugin") {
    return null;
  }
  const metaItem = snapshot.items.find(
    (item) => item.id === MANAGED_PLUGIN_META_ID
  );
  const pluginItems = snapshot.items.filter(
    (item) => item.id !== MANAGED_PLUGIN_META_ID
  );
  if (pluginItems.length === 0 && !metaItem) {
    return null;
  }
  const plugins: ManagedPluginCatalogSnapshot["plugins"] = [];
  for (const item of pluginItems) {
    const parsed = managedPluginCatalogRowSchema.safeParse(item.details);
    if (parsed.success) {
      plugins.push(parsed.data);
    }
  }
  const meta = metaSchema.safeParse(metaItem?.details);
  if (plugins.length === 0 && !meta.success) {
    return null;
  }
  return {
    checkedAt: meta.success
      ? meta.data.checkedAt
      : (snapshot.remoteCheckedAt ?? snapshot.localProbedAt ?? 0),
    officialMutationsAllowed: meta.success
      ? meta.data.officialMutationsAllowed
      : true,
    pluginMode: meta.success ? meta.data.pluginMode : "release",
    plugins,
  };
}
