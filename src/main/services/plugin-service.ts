import { readFile } from "node:fs/promises";
import type {
  PluginManifest,
  PluginRegistryEntry,
  PluginRegistryState,
  PluginSource,
} from "@shared/contracts/plugin.ts";
import { pluginManifestSchema } from "@shared/contracts/plugin.ts";
import {
  readPluginState,
  setPluginEnabledState,
} from "../state/plugin-state.ts";

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
  | { kind: "builtin"; manifest: unknown }
  | { kind: "local"; path: string }
  | { kind: "git" | "registry"; integrity?: string; url?: string };

export interface PluginStateStore {
  read(): Promise<PluginRegistryState>;
  setEnabled(id: string, enabled: boolean): Promise<PluginRegistryState>;
}

export interface PluginService {
  inspect(id: string): Promise<PluginRegistryEntry | null>;
  list(): Promise<PluginRegistryEntry[]>;
  setEnabled(id: string, enabled: boolean): Promise<PluginRegistryEntry>;
}

export interface CreatePluginServiceOptions {
  readTextFile?: (path: string) => Promise<string>;
  sources?: PluginDiscoverySource[];
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
  state: PluginRegistryState
): PluginRegistryEntry {
  return {
    commands: manifest.commands,
    enabled: state.plugins[manifest.id]?.enabled ?? false,
    id: manifest.id,
    manifest,
    panels: manifest.panels,
    permissions: manifest.permissions,
    source: sourceFromManifest(manifest),
    version: manifest.version,
  };
}

function parseManifest(raw: unknown): PluginManifest {
  const parsed = pluginManifestSchema.safeParse(raw);
  if (!parsed.success) {
    throw new PluginServiceError("invalid_manifest", "invalid plugin manifest");
  }
  return parsed.data;
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
  async function list(): Promise<PluginRegistryEntry[]> {
    const manifests: PluginManifest[] = [];
    for (const source of sources) {
      manifests.push(await readSourceManifest(source, readTextFile));
    }
    const registryState = await state.read();
    return manifests.map((manifest) =>
      entryFromManifest(manifest, registryState)
    );
  }

  async function inspect(id: string): Promise<PluginRegistryEntry | null> {
    const entries = await list();
    return entries.find((entry) => entry.id === id) ?? null;
  }

  async function setEnabled(
    id: string,
    enabled: boolean
  ): Promise<PluginRegistryEntry> {
    const existing = await inspect(id);
    if (!existing) {
      throw new PluginServiceError("not_found", `plugin not found: ${id}`);
    }
    const nextState = await state.setEnabled(id, enabled);
    return entryFromManifest(existing.manifest, nextState);
  }

  return { inspect, list, setEnabled };
}
