import type {
  RendererPluginContext,
  RendererPluginMessageValues,
} from "@plugins/api/renderer.ts";
import type { PluginRegistryEntry } from "@shared/contracts/plugin.ts";
import i18next from "i18next";
import {
  interpolateMessage,
  resolvePluginCommandDisplay,
  resolvePluginMessage,
} from "../display.ts";

export function createPluginI18n(
  entry?: PluginRegistryEntry
): RendererPluginContext["i18n"] {
  const language = () => i18next.language || "en";
  const commandById = (commandId: string) =>
    entry?.manifest.commands.find((command) => command.id === commandId);

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
    // fallback 也过插值：locale 缺 key 时用户不应看到字面 {{name}} 占位符。
    t: (
      key: string,
      values?: RendererPluginMessageValues,
      fallback = key,
      locale?: string
    ) =>
      entry
        ? (resolvePluginMessage(
            entry.manifest,
            locale ?? language(),
            key,
            values
          ) ?? interpolateMessage(fallback, values))
        : interpolateMessage(fallback, values),
  };
}
