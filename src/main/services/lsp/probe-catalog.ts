import type {
  LspCatalogEntry,
  LspCatalogStatusRow,
  LspServerLaunchSpec,
  LspServerProvider,
} from "@shared/contracts/lsp-provider.ts";
import { CORE_LSP_CATALOG } from "./core-catalog.ts";
import {
  probeResolvedBinaryVersion,
  shouldProbeBinaryVersion,
} from "./probe-version.ts";
import {
  binaryPathFromLaunchSpec,
  resolveFirstCommandOnPath,
} from "./resolve-command.ts";
import type { LspServerRegistry } from "./server-registry.ts";

export const LSP_VERSION_PROBE_CONCURRENCY = 4;
export const LSP_CATALOG_VERSION_BUDGET_MS = 2000;

/** Helpers that are not the language server itself (`which` hits would lie). */
const CATALOG_PATH_SKIP_NAMES = new Set([
  "@vue/typescript-plugin",
  "language_server.sh",
  "xcrun",
]);

export function pathProbeCandidates(binaryHint: string): string[] {
  return binaryHint
    .split("|")
    .map((part) => part.trim())
    .filter((part) => part.length > 0 && !CATALOG_PATH_SKIP_NAMES.has(part));
}

function probeCatalogEntry(entry: LspCatalogEntry): LspCatalogStatusRow {
  if (entry.binaryHint === "bundled") {
    return { ...entry, status: "bundled" };
  }
  const resolvedPath = resolveFirstCommandOnPath(
    pathProbeCandidates(entry.binaryHint)
  );
  return {
    ...entry,
    status: resolvedPath ? "available" : "missing",
    ...(resolvedPath ? { resolvedPath } : {}),
  };
}

export function probeCoreLspCatalog(
  catalog: readonly LspCatalogEntry[] = CORE_LSP_CATALOG
): LspCatalogStatusRow[] {
  return catalog.map((entry) => probeCatalogEntry(entry));
}

function rowFromResolvedLaunch(
  provider: LspServerProvider,
  launch: LspServerLaunchSpec
): LspCatalogStatusRow {
  const resolvedPath = binaryPathFromLaunchSpec(launch) ?? undefined;
  return {
    binaryHint: provider.id,
    displayName: provider.displayName,
    extensions: [...provider.selector.extensions],
    id: provider.id,
    source: provider.source ?? "plugin",
    status: "available",
    ...(resolvedPath ? { resolvedPath } : {}),
    ...(provider.installCommand
      ? { installCommand: provider.installCommand }
      : {}),
  };
}

function missingRegistryRow(provider: LspServerProvider): LspCatalogStatusRow {
  return {
    binaryHint: provider.id,
    displayName: provider.displayName,
    extensions: [...provider.selector.extensions],
    id: provider.id,
    source: provider.source ?? "plugin",
    status: "missing",
    ...(provider.installCommand
      ? { installCommand: provider.installCommand }
      : {}),
  };
}

/** Dynamic rows from custom + plugin providers already in the registry. */
export async function catalogRowsFromRegistry(
  registry: LspServerRegistry
): Promise<LspCatalogStatusRow[]> {
  const coreIds = new Set(CORE_LSP_CATALOG.map((entry) => entry.id));
  const rows: LspCatalogStatusRow[] = [];
  for (const provider of registry.list()) {
    if (coreIds.has(provider.id) || provider.source === "core") {
      continue;
    }
    const launch = await Promise.resolve(
      provider.resolveLaunch({
        rootPath: process.cwd(),
        workspaceKey: "catalog-probe",
      })
    );
    rows.push(
      launch
        ? rowFromResolvedLaunch(provider, launch)
        : missingRegistryRow(provider)
    );
  }
  return rows;
}

async function enrichOneRow(
  row: LspCatalogStatusRow
): Promise<LspCatalogStatusRow> {
  if (
    row.status !== "available" ||
    !row.resolvedPath ||
    !shouldProbeBinaryVersion(row.resolvedPath)
  ) {
    return row;
  }
  const version = await probeResolvedBinaryVersion(row.resolvedPath);
  return version ? { ...row, version } : row;
}

/** Fill `version` for PATH hits whose basename is a known `--version` CLI. */
export async function enrichCatalogVersions(
  rows: readonly LspCatalogStatusRow[]
): Promise<LspCatalogStatusRow[]> {
  if (rows.length === 0) {
    return [];
  }
  const out = [...rows];
  const deadline = Date.now() + LSP_CATALOG_VERSION_BUDGET_MS;
  for (let i = 0; i < rows.length; i += LSP_VERSION_PROBE_CONCURRENCY) {
    if (Date.now() >= deadline) {
      break;
    }
    const slice = rows.slice(i, i + LSP_VERSION_PROBE_CONCURRENCY);
    const enriched = await Promise.all(slice.map((row) => enrichOneRow(row)));
    out.splice(i, enriched.length, ...enriched);
  }
  return out;
}
