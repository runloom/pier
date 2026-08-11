/**
 * Materialize plugin + L1 custom-server contributions into the editor
 * language-mode registry (display track).
 */

import type { LspCustomServer } from "@shared/contracts/lsp.ts";
import type { PluginRegistryEntry } from "@shared/contracts/plugin.ts";
import {
  type EditorHighlightPreset,
  editorHighlightPresetSchema,
  type PluginLanguageModeContribution,
} from "@shared/contracts/plugin-language-mode.ts";
import {
  type EditorLanguageModeEntry,
  editorLanguageModeRegistry,
} from "./language-mode-registry.ts";

function parseHighlight(raw: unknown): EditorHighlightPreset {
  const parsed = editorHighlightPresetSchema.safeParse(raw ?? "text");
  return parsed.success ? parsed.data : "text";
}

export function modesFromPluginRegistry(
  plugins: readonly PluginRegistryEntry[]
): EditorLanguageModeEntry[] {
  const modes: EditorLanguageModeEntry[] = [];
  for (const entry of plugins) {
    if (!entry.runtime.enabled) {
      continue;
    }
    if (!entry.manifest.permissions.includes("languageMode:provide")) {
      continue;
    }
    const contributions = entry.manifest.languageModes ?? [];
    for (const contribution of contributions) {
      modes.push(modeFromPluginContribution(entry.manifest.id, contribution));
    }
  }
  return modes;
}

export function modeFromPluginContribution(
  pluginId: string,
  contribution: PluginLanguageModeContribution
): EditorLanguageModeEntry {
  const languageId = contribution.languageId ?? contribution.id;
  return {
    displayName: contribution.displayName,
    extensions: contribution.extensions.map((ext) => ext.toLowerCase()),
    highlight: parseHighlight(contribution.highlight),
    languageId,
    priority: contribution.priority ?? 70,
    source: "plugin",
    sourceId: `${pluginId}:${contribution.id}`,
  };
}

export function modesFromCustomServers(
  servers: readonly LspCustomServer[]
): EditorLanguageModeEntry[] {
  return servers.map((server) => {
    const languageId = server.languageIds[0] ?? server.id;
    return {
      displayName: server.displayName,
      extensions: server.extensions.map((ext) => ext.toLowerCase()),
      highlight: parseHighlight(server.highlightPreset),
      languageId,
      priority: server.priority ?? 50,
      source: "custom" as const,
      sourceId: `custom:${server.id}`,
    };
  });
}

export function syncEditorLanguageModes(input: {
  customServers?: readonly LspCustomServer[];
  plugins?: readonly PluginRegistryEntry[];
}): void {
  if (input.plugins) {
    editorLanguageModeRegistry.replacePluginModes(
      modesFromPluginRegistry(input.plugins)
    );
  }
  if (input.customServers) {
    editorLanguageModeRegistry.replaceCustomModes(
      modesFromCustomServers(input.customServers)
    );
  }
}
