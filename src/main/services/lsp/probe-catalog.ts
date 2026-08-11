import type {
  LspBinaryStatus,
  LspCatalogEntry,
  LspCatalogStatusRow,
} from "@shared/contracts/lsp-provider.ts";
import { CORE_LSP_CATALOG } from "./core-catalog.ts";
import { resolveFirstCommandOnPath } from "./resolve-command.ts";
import type { LspServerRegistry } from "./server-registry.ts";

function statusForCatalogEntry(entry: LspCatalogEntry): LspBinaryStatus {
  if (entry.binaryHint === "bundled") {
    return "bundled";
  }
  const candidates = entry.binaryHint
    .split("|")
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
  const hit = resolveFirstCommandOnPath(candidates);
  return hit ? "available" : "missing";
}

export function probeCoreLspCatalog(
  catalog: readonly LspCatalogEntry[] = CORE_LSP_CATALOG
): LspCatalogStatusRow[] {
  return catalog.map((entry) => ({
    ...entry,
    status: statusForCatalogEntry(entry),
  }));
}

/** Dynamic rows from custom + plugin providers already in the registry. */
export function catalogRowsFromRegistry(
  registry: LspServerRegistry
): LspCatalogStatusRow[] {
  const coreIds = new Set(CORE_LSP_CATALOG.map((entry) => entry.id));
  const rows: LspCatalogStatusRow[] = [];
  for (const provider of registry.list()) {
    if (coreIds.has(provider.id) || provider.source === "core") {
      continue;
    }
    const launch = provider.resolveLaunch({
      rootPath: process.cwd(),
      workspaceKey: "catalog-probe",
    });
    const resolved = launch instanceof Promise ? null : launch;
    rows.push({
      binaryHint: provider.id,
      displayName: provider.displayName,
      extensions: [...provider.selector.extensions],
      id: provider.id,
      source: provider.source ?? "plugin",
      status: resolved ? "available" : "missing",
      ...(provider.installCommand
        ? { installCommand: provider.installCommand }
        : {}),
    });
  }
  return rows;
}
