import { readFile } from "node:fs/promises";
import { dirname } from "node:path";
import type {
  PluginLocaleMessages,
  PluginManifest,
  PluginRegistryDiagnostic,
  PluginRegistryDiagnosticSource,
  PluginRegistryEntry,
  PluginRegistryListResult,
  PluginRegistryState,
  PluginSource,
} from "@shared/contracts/plugin.ts";
import { pluginManifestSchema } from "@shared/contracts/plugin.ts";
import {
  readPluginState,
  setPluginEnabledState,
} from "../state/plugin-state.ts";
import { loadManifestLocaleFiles } from "./plugin-localization.ts";

export type PluginServiceErrorCode =
  | "invalid_manifest"
  | "not_found"
  | "unsupported";

export class PluginServiceError extends Error {
  readonly code: PluginServiceErrorCode;

  constructor(code: PluginServiceErrorCode, message: string) {
    super(message);
    this.name = "PluginServiceError";
    this.code = code;
  }
}

export type PluginDiscoverySource =
  | {
      baseDir?: string;
      defaultEnabled?: boolean;
      kind: "builtin";
      locales?: Record<string, PluginLocaleMessages>;
      manifest: unknown;
    }
  | { kind: "local"; path: string }
  | { kind: "git" | "registry"; integrity?: string; url?: string };

export type PluginDiscoverySourceProvider =
  | readonly PluginDiscoverySource[]
  | (() =>
      | Promise<readonly PluginDiscoverySource[]>
      | readonly PluginDiscoverySource[]);

export interface PluginStateStore {
  read(): Promise<PluginRegistryState>;
  setEnabled(id: string, enabled: boolean): Promise<PluginRegistryState>;
}

export interface PluginService {
  inspect(id: string): Promise<PluginRegistryEntry | null>;
  list(): Promise<PluginRegistryListResult>;
  setEnabled(id: string, enabled: boolean): Promise<PluginRegistryEntry>;
}

export interface CreatePluginServiceOptions {
  readTextFile?: (path: string) => Promise<string>;
  sources?: PluginDiscoverySourceProvider;
  state?: PluginStateStore;
}

const DEFAULT_STATE: PluginStateStore = {
  read: readPluginState,
  setEnabled: setPluginEnabledState,
};

function sourceFromManifest(manifest: PluginManifest): PluginSource {
  return manifest.source;
}

function entryFromManifest(
  manifest: PluginManifest,
  state: PluginRegistryState,
  options: { defaultEnabled?: boolean } = {}
): PluginRegistryEntry {
  return {
    commands: manifest.commands,
    enabled:
      state.plugins[manifest.id]?.enabled ?? options.defaultEnabled === true,
    id: manifest.id,
    manifest,
    panels: manifest.panels,
    permissions: manifest.permissions,
    source: sourceFromManifest(manifest),
    version: manifest.version,
  };
}

function diagnosticSource(
  source: PluginDiscoverySource
): PluginRegistryDiagnosticSource {
  switch (source.kind) {
    case "builtin":
      return { kind: "builtin" };
    case "local":
      return { kind: "local", path: source.path };
    case "git":
    case "registry":
      return {
        ...(source.integrity && { integrity: source.integrity }),
        kind: source.kind,
        ...(source.url && { url: source.url }),
      };
    default: {
      const _exhaustive: never = source;
      return _exhaustive;
    }
  }
}

function diagnosticFromError(
  source: PluginDiscoverySource,
  err: unknown
): PluginRegistryDiagnostic {
  if (err instanceof PluginServiceError) {
    return {
      code: err.code === "unsupported" ? "unsupported" : "invalid_manifest",
      message: err.message,
      source: diagnosticSource(source),
    };
  }
  return {
    code: "invalid_manifest",
    message: err instanceof Error ? err.message : "invalid plugin manifest",
    source: diagnosticSource(source),
  };
}

function parseManifest(raw: unknown): PluginManifest {
  const parsed = pluginManifestSchema.safeParse(raw);
  if (!parsed.success) {
    throw new PluginServiceError("invalid_manifest", "invalid plugin manifest");
  }
  return parsed.data;
}

function localeBaseDir(source: PluginDiscoverySource): string | null {
  switch (source.kind) {
    case "builtin":
      return source.baseDir ?? null;
    case "local":
      return dirname(source.path);
    case "git":
    case "registry":
      return null;
    default: {
      const _exhaustive: never = source;
      return _exhaustive;
    }
  }
}

async function readLocalManifest(
  path: string,
  readTextFile: (path: string) => Promise<string>
): Promise<PluginManifest> {
  try {
    return parseManifest(JSON.parse(await readTextFile(path)));
  } catch (err) {
    if (err instanceof PluginServiceError) {
      throw err;
    }
    throw new PluginServiceError("invalid_manifest", "invalid plugin manifest");
  }
}

async function readSourceManifest(
  source: PluginDiscoverySource,
  readTextFile: (path: string) => Promise<string>
): Promise<PluginManifest> {
  switch (source.kind) {
    case "builtin":
      return parseManifest(source.manifest);
    case "local":
      return await readLocalManifest(source.path, readTextFile);
    case "git":
    case "registry":
      throw new PluginServiceError(
        "unsupported",
        `plugin source kind is not supported yet: ${source.kind}`
      );
    default: {
      const _exhaustive: never = source;
      return _exhaustive;
    }
  }
}

export function createPluginService({
  readTextFile = (path) => readFile(path, "utf8"),
  sources = [],
  state = DEFAULT_STATE,
}: CreatePluginServiceOptions = {}): PluginService {
  async function resolveSources(): Promise<readonly PluginDiscoverySource[]> {
    return typeof sources === "function" ? await sources() : sources;
  }

  async function list(): Promise<PluginRegistryListResult> {
    const manifests: Array<{
      manifest: PluginManifest;
      source: PluginDiscoverySource;
    }> = [];
    const diagnostics: PluginRegistryDiagnostic[] = [];
    for (const source of await resolveSources()) {
      try {
        const manifest = await readSourceManifest(source, readTextFile);
        const withLocales = await loadManifestLocaleFiles({
          baseDir: localeBaseDir(source),
          manifest,
          readTextFile,
          source,
          staticLocales:
            source.kind === "builtin" ? (source.locales ?? {}) : {},
        });
        diagnostics.push(...withLocales.diagnostics);
        manifests.push({ manifest: withLocales.manifest, source });
      } catch (err) {
        diagnostics.push(diagnosticFromError(source, err));
      }
    }
    const registryState = await state.read();
    return {
      diagnostics,
      entries: manifests.map(({ manifest, source }) =>
        entryFromManifest(manifest, registryState, {
          defaultEnabled:
            source.kind === "builtin" && source.defaultEnabled === true,
        })
      ),
    };
  }

  async function inspect(id: string): Promise<PluginRegistryEntry | null> {
    const result = await list();
    return result.entries.find((entry) => entry.id === id) ?? null;
  }

  async function setEnabled(
    id: string,
    enabled: boolean
  ): Promise<PluginRegistryEntry> {
    const existing = await inspect(id);
    if (!existing) {
      throw new PluginServiceError("not_found", `plugin not found: ${id}`);
    }
    if (
      !(existing.source.kind === "builtin" || existing.source.kind === "local")
    ) {
      throw new PluginServiceError(
        "unsupported",
        `plugin source kind cannot be enabled yet: ${existing.source.kind}`
      );
    }
    const nextState = await state.setEnabled(id, enabled);
    return entryFromManifest(existing.manifest, nextState);
  }

  return { inspect, list, setEnabled };
}
