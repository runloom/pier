import type {
  RendererPluginContext,
  RendererPluginMessageValues,
} from "@plugins/api/renderer.ts";
import type { PluginRegistryEntry } from "@shared/contracts/plugin.ts";
import i18next from "i18next";
import { terminalStatusItemRegistry } from "../../panel-kits/terminal/terminal-status-bar.tsx";
import { usePanelDescriptorStore } from "../../stores/panel-descriptor.store.ts";
import { actionRegistry } from "../actions/registry.ts";
import { useCommandPaletteController } from "../command-palette/controller.ts";
import {
  resolvePluginCommandDisplay,
  resolvePluginMessage,
} from "./display.ts";

function createPluginI18n(
  entry?: PluginRegistryEntry
): RendererPluginContext["i18n"] {
  const language = () => i18next.language || "en";
  const commandById = (commandId: string) =>
    entry?.commands.find((command) => command.id === commandId);

  return {
    commandDescription: (commandId) => {
      const command = commandById(commandId);
      if (!(entry && command)) {
        return;
      }
      return resolvePluginCommandDisplay(entry.manifest, command, language())
        .description;
    },
    commandTitle: (commandId, fallback = commandId) => {
      const command = commandById(commandId);
      if (!(entry && command)) {
        return fallback;
      }
      return resolvePluginCommandDisplay(entry.manifest, command, language())
        .title;
    },
    language,
    t: (key: string, values?: RendererPluginMessageValues, fallback = key) =>
      entry
        ? (resolvePluginMessage(entry.manifest, language(), key, values) ??
          fallback)
        : fallback,
  };
}

export function createRendererPluginContext(
  entry?: PluginRegistryEntry
): RendererPluginContext {
  return {
    actions: {
      register: (action) => actionRegistry.register(action),
    },
    commandPalette: {
      openQuickPick: (quickPick) =>
        useCommandPaletteController.getState().openQuickPick(quickPick),
    },
    i18n: createPluginI18n(entry),
    panels: {
      getActiveContext: () => {
        const state = usePanelDescriptorStore.getState();
        return state.activeId
          ? (state.descriptors[state.activeId]?.context ?? null)
          : null;
      },
    },
    terminalStatusItems: {
      register: (item) => terminalStatusItemRegistry.register(item),
    },
    worktrees: {
      check: (request) => window.pier.worktrees.check(request),
      list: (request) => window.pier.worktrees.list(request),
      open: (request) => window.pier.worktrees.open(request),
    },
  };
}
