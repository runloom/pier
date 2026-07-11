import { readFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { PierCapability } from "@shared/contracts/permissions.ts";
import { pierCapabilitySchema } from "@shared/contracts/permissions.ts";
import type {
  PluginLocaleMessages,
  PluginManifest,
  PluginRegistryDiagnostic,
  PluginRegistryDiagnosticSource,
  PluginRegistryEntry,
  PluginRegistryListResult,
  PluginRegistryState,
} from "@shared/contracts/plugin.ts";
import { pluginManifestSchema } from "@shared/contracts/plugin.ts";
import {
  readPluginState,
  setPluginEnabledState,
} from "../state/plugin-state.ts";
import {
  findCommandIdConflict,
  findMissionControlWidgetIdConflict,
  findPanelIdConflict,
  findPluginIdDotPrefixConflict,
  findTerminalStatusItemIdConflict,
} from "./plugin-contribution-conflicts.ts";
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

export interface ExternalPluginRuntimeSource {
  readonly enabled: boolean;
  readonly id: string;
  readonly manifest: PluginManifest;
  readonly rendererEntryUrl: string;
  readonly source: "official" | "devOverride";
  readonly sourceRevision?: string;
  readonly version: string;
}

export interface CreatePluginServiceOptions {
  externalRuntimeSources?: () => readonly ExternalPluginRuntimeSource[];
  readTextFile?: (path: string) => Promise<string>;
  sources?: PluginDiscoverySourceProvider;
  state?: PluginStateStore;
}

const DEFAULT_STATE: PluginStateStore = {
  read: readPluginState,
  setEnabled: setPluginEnabledState,
};

const CAPABILITY_ORDER = new Map(
  pierCapabilitySchema.options.map((capability, index) => [capability, index])
);

export function collectEffectivePermissions(
  manifest: PluginManifest
): PierCapability[] {
  const permissions = new Set<PierCapability>();
  for (const permission of manifest.permissions) {
    permissions.add(permission);
  }
  for (const command of manifest.commands) {
    for (const permission of command.permissions) {
      permissions.add(permission);
    }
  }
  for (const panel of manifest.panels) {
    for (const permission of panel.permissions) {
      permissions.add(permission);
    }
  }
  for (const item of manifest.terminalStatusItems) {
    for (const permission of item.permissions) {
      permissions.add(permission);
    }
  }
  for (const widget of manifest.missionControlWidgets) {
    for (const permission of widget.permissions) {
      permissions.add(permission);
    }
  }
  return Array.from(permissions).sort(
    (a, b) => (CAPABILITY_ORDER.get(a) ?? 0) - (CAPABILITY_ORDER.get(b) ?? 0)
  );
}

function isExecutableSource(source: PluginDiscoverySource): boolean {
  return source.kind === "builtin";
}

function runtimeDisabledReason(
  source: PluginDiscoverySource
): string | undefined {
  return source.kind === "builtin"
    ? undefined
    : `plugin source kind is manifest-only in this version: ${source.kind}`;
}

function entryFromManifest(
  manifest: PluginManifest,
  state: PluginRegistryState,
  options: { defaultEnabled?: boolean; source: PluginDiscoverySource }
): PluginRegistryEntry {
  const executable = isExecutableSource(options.source);
  const enabled =
    state.plugins[manifest.id]?.enabled ?? options.defaultEnabled === true;
  const runtimeEnabled = executable && enabled;
  const disabledReason = runtimeDisabledReason(options.source);
  return {
    effectivePermissions: collectEffectivePermissions(manifest),
    enabled,
    manifest,
    runtime: {
      canToggle: executable,
      ...(disabledReason && { disabledReason }),
      enabled: runtimeEnabled,
      kind: executable ? "builtin" : "manifest-only",
    },
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
  externalRuntimeSources,
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
        const conflict = findPluginIdDotPrefixConflict(
          manifests.map((item) => item.manifest.id),
          withLocales.manifest.id
        );
        if (conflict) {
          diagnostics.push({
            code: "invalid_manifest",
            message: `plugin id must not be a dot-separated prefix of another plugin id ("${conflict}"): ${withLocales.manifest.id}`,
            source: diagnosticSource(source),
          });
          continue;
        }
        const commandConflict = findCommandIdConflict(
          manifests.map((item) => item.manifest),
          withLocales.manifest
        );
        if (commandConflict) {
          diagnostics.push({
            code: "invalid_manifest",
            message: `commands id must be unique across plugins and within one manifest ("${commandConflict}"): ${withLocales.manifest.id}`,
            source: diagnosticSource(source),
          });
          continue;
        }
        const panelConflict = findPanelIdConflict(
          manifests.map((item) => item.manifest),
          withLocales.manifest
        );
        if (panelConflict) {
          diagnostics.push({
            code: "invalid_manifest",
            message: `panels id must be unique across plugins and within one manifest ("${panelConflict}"): ${withLocales.manifest.id}`,
            source: diagnosticSource(source),
          });
          continue;
        }
        const statusItemConflict = findTerminalStatusItemIdConflict(
          manifests.map((item) => item.manifest),
          withLocales.manifest
        );
        if (statusItemConflict) {
          diagnostics.push({
            code: "invalid_manifest",
            message: `terminalStatusItems id must be unique across plugins ("${statusItemConflict}"): ${withLocales.manifest.id}`,
            source: diagnosticSource(source),
          });
          continue;
        }
        const missionControlWidgetConflict = findMissionControlWidgetIdConflict(
          manifests.map((item) => item.manifest),
          withLocales.manifest
        );
        if (missionControlWidgetConflict) {
          diagnostics.push({
            code: "invalid_manifest",
            message: `missionControlWidgets id must be unique across plugins ("${missionControlWidgetConflict}"): ${withLocales.manifest.id}`,
            source: diagnosticSource(source),
          });
          continue;
        }
        manifests.push({ manifest: withLocales.manifest, source });
      } catch (err) {
        diagnostics.push(diagnosticFromError(source, err));
      }
    }
    const registryState = await state.read();
    const externalEntries: PluginRegistryEntry[] = [];
    if (externalRuntimeSources) {
      for (const ext of externalRuntimeSources()) {
        const acceptedManifests = [
          ...manifests.map((item) => item.manifest),
          ...externalEntries.map((item) => item.manifest),
        ];
        const conflict = findPluginIdDotPrefixConflict(
          acceptedManifests.map((manifest) => manifest.id),
          ext.manifest.id
        );
        if (conflict) {
          diagnostics.push({
            code: "invalid_manifest",
            message: `plugin id must not be a dot-separated prefix of another plugin id ("${conflict}"): ${ext.manifest.id}`,
            source: { kind: ext.source },
          });
          continue;
        }
        const commandConflict = findCommandIdConflict(
          acceptedManifests,
          ext.manifest
        );
        if (commandConflict) {
          diagnostics.push({
            code: "invalid_manifest",
            message: `commands id must be unique across plugins and within one manifest ("${commandConflict}"): ${ext.manifest.id}`,
            source: { kind: ext.source },
          });
          continue;
        }
        const panelConflict = findPanelIdConflict(
          acceptedManifests,
          ext.manifest
        );
        if (panelConflict) {
          diagnostics.push({
            code: "invalid_manifest",
            message: `panels id must be unique across plugins and within one manifest ("${panelConflict}"): ${ext.manifest.id}`,
            source: { kind: ext.source },
          });
          continue;
        }
        const statusItemConflict = findTerminalStatusItemIdConflict(
          acceptedManifests,
          ext.manifest
        );
        if (statusItemConflict) {
          diagnostics.push({
            code: "invalid_manifest",
            message: `terminalStatusItems id must be unique across plugins ("${statusItemConflict}"): ${ext.manifest.id}`,
            source: { kind: ext.source },
          });
          continue;
        }
        const missionControlWidgetConflict = findMissionControlWidgetIdConflict(
          acceptedManifests,
          ext.manifest
        );
        if (missionControlWidgetConflict) {
          diagnostics.push({
            code: "invalid_manifest",
            message: `missionControlWidgets id must be unique across plugins ("${missionControlWidgetConflict}"): ${ext.manifest.id}`,
            source: { kind: ext.source },
          });
          continue;
        }
        externalEntries.push({
          effectivePermissions: collectEffectivePermissions(ext.manifest),
          enabled: ext.enabled,
          manifest: ext.manifest,
          runtime: {
            canToggle: true,
            enabled: ext.enabled,
            kind: "external",
            rendererEntryUrl: ext.rendererEntryUrl,
            ...(ext.sourceRevision
              ? { sourceRevision: ext.sourceRevision }
              : {}),
          },
        });
      }
    }
    return {
      diagnostics,
      entries: [
        ...manifests.map(({ manifest, source }) =>
          entryFromManifest(manifest, registryState, {
            defaultEnabled:
              source.kind === "builtin" && source.defaultEnabled === true,
            source,
          })
        ),
        ...externalEntries,
      ],
    };
  }

  async function inspect(id: string): Promise<PluginRegistryEntry | null> {
    const result = await list();
    return result.entries.find((entry) => entry.manifest.id === id) ?? null;
  }

  async function setEnabled(
    id: string,
    enabled: boolean
  ): Promise<PluginRegistryEntry> {
    const existing = await inspect(id);
    if (!existing) {
      throw new PluginServiceError("not_found", `plugin not found: ${id}`);
    }
    if (!existing.runtime.canToggle) {
      throw new PluginServiceError(
        "unsupported",
        `plugin source kind cannot be enabled yet: ${existing.manifest.source.kind}`
      );
    }
    const nextState = await state.setEnabled(id, enabled);
    return entryFromManifest(existing.manifest, nextState, {
      source: {
        kind: "builtin",
        manifest: existing.manifest,
      },
    });
  }

  return { inspect, list, setEnabled };
}
