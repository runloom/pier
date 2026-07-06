import type { PluginDashboardWidgetContribution } from "@shared/contracts/dashboard.ts";
import type {
  PluginCommandContribution,
  PluginLocaleMessages,
  PluginManifest,
  PluginPanelContribution,
  PluginRegistryEntry,
  PluginTerminalStatusItemContribution,
} from "@shared/contracts/plugin.ts";

export interface PluginDisplayText {
  description?: string;
  name: string;
}

export interface PluginContributionDisplayText {
  description?: string;
  title: string;
}

export interface PluginCommandDisplayText
  extends PluginContributionDisplayText {
  category?: string;
}

export type PluginMessageValues = Record<string, number | string>;

function unique(values: string[]): string[] {
  return Array.from(new Set(values.filter(Boolean)));
}

function languagePrefix(locale: string): string | null {
  const separatorIndex = locale.indexOf("-");
  return separatorIndex > 0 ? locale.slice(0, separatorIndex) : null;
}

function localeCandidates(
  locale: string,
  defaultLocale: string | undefined
): string[] {
  return unique([
    locale,
    languagePrefix(locale) ?? "",
    defaultLocale ?? "",
    languagePrefix(defaultLocale ?? "") ?? "",
  ]);
}

function allLocaleCandidates(
  manifest: PluginManifest,
  locale: string
): string[] {
  return unique([
    ...localeCandidates(locale, manifest.localization?.defaultLocale),
    ...(manifest.localization?.locales ?? []),
    ...Object.keys(manifest.locales ?? {}),
  ]);
}

function resolveFromLocales(
  manifest: PluginManifest,
  locale: string,
  pick: (messages: PluginLocaleMessages) => string | undefined
): string | undefined {
  for (const candidate of localeCandidates(
    locale,
    manifest.localization?.defaultLocale
  )) {
    const value = manifest.locales?.[candidate];
    if (!value) {
      continue;
    }
    const resolved = pick(value);
    if (resolved) {
      return resolved;
    }
  }
  return;
}

function resolveListFromLocales(
  manifest: PluginManifest,
  locale: string,
  pick: (messages: PluginLocaleMessages) => readonly string[] | undefined
): string[] {
  const values: string[] = [];
  for (const candidate of allLocaleCandidates(manifest, locale)) {
    const value = manifest.locales?.[candidate];
    if (!value) {
      continue;
    }
    values.push(...(pick(value) ?? []));
  }
  return unique(values);
}

export function interpolateMessage(
  template: string,
  values: PluginMessageValues | undefined
): string {
  if (!values) {
    return template;
  }
  return template.replace(/\{\{\s*([A-Za-z0-9_.-]+)\s*\}\}/g, (match, key) => {
    const value = values[key];
    return value === undefined ? match : String(value);
  });
}

export function resolvePluginMessage(
  manifest: PluginManifest,
  locale: string,
  key: string,
  values?: PluginMessageValues
): string | undefined {
  const message = resolveFromLocales(
    manifest,
    locale,
    (messages) => messages.messages?.[key]
  );
  return message ? interpolateMessage(message, values) : undefined;
}

export function resolvePluginDisplay(
  entry: PluginRegistryEntry,
  locale: string
): PluginDisplayText {
  const description =
    resolveFromLocales(
      entry.manifest,
      locale,
      (messages) => messages.description
    ) ?? entry.manifest.description;
  return {
    name:
      resolveFromLocales(entry.manifest, locale, (messages) => messages.name) ??
      entry.manifest.name,
    ...(description ? { description } : {}),
  };
}

export function resolvePluginCommandDisplay(
  manifest: PluginManifest,
  command: PluginCommandContribution,
  locale: string
): PluginCommandDisplayText {
  const category =
    resolveFromLocales(
      manifest,
      locale,
      (messages) => messages.commands?.[command.id]?.category
    ) ?? command.category;
  const description =
    resolveFromLocales(
      manifest,
      locale,
      (messages) => messages.commands?.[command.id]?.description
    ) ?? command.description;
  return {
    title:
      resolveFromLocales(
        manifest,
        locale,
        (messages) => messages.commands?.[command.id]?.title
      ) ?? command.title,
    ...(category ? { category } : {}),
    ...(description ? { description } : {}),
  };
}

export function resolvePluginCommandAliases(
  manifest: PluginManifest,
  command: PluginCommandContribution,
  locale: string
): string[] {
  return resolveListFromLocales(
    manifest,
    locale,
    (messages) => messages.commands?.[command.id]?.aliases
  );
}

export function resolvePluginPanelDisplay(
  manifest: PluginManifest,
  panel: PluginPanelContribution,
  locale: string
): PluginContributionDisplayText {
  const description =
    resolveFromLocales(
      manifest,
      locale,
      (messages) => messages.panels?.[panel.id]?.description
    ) ?? panel.description;
  return {
    title:
      resolveFromLocales(
        manifest,
        locale,
        (messages) => messages.panels?.[panel.id]?.title
      ) ?? panel.title,
    ...(description ? { description } : {}),
  };
}

export function resolvePluginTerminalStatusItemDisplay(
  manifest: PluginManifest,
  item: PluginTerminalStatusItemContribution,
  locale: string
): PluginContributionDisplayText {
  const description =
    resolveFromLocales(
      manifest,
      locale,
      (messages) => messages.terminalStatusItems?.[item.id]?.description
    ) ?? item.description;
  return {
    title:
      resolveFromLocales(
        manifest,
        locale,
        (messages) => messages.terminalStatusItems?.[item.id]?.title
      ) ?? item.title,
    ...(description ? { description } : {}),
  };
}

export function resolvePluginDashboardWidgetDisplay(
  manifest: PluginManifest,
  widget: PluginDashboardWidgetContribution,
  locale: string
): PluginContributionDisplayText {
  const description =
    resolveFromLocales(
      manifest,
      locale,
      (messages) => messages.dashboardWidgets?.[widget.id]?.description
    ) ?? widget.description;
  return {
    title:
      resolveFromLocales(
        manifest,
        locale,
        (messages) => messages.dashboardWidgets?.[widget.id]?.title
      ) ?? widget.title,
    ...(description ? { description } : {}),
  };
}

function resolveArrayFromLocales(
  manifest: PluginManifest,
  locale: string,
  pick: (messages: PluginLocaleMessages) => readonly string[] | undefined
): readonly string[] | undefined {
  for (const candidate of localeCandidates(
    locale,
    manifest.localization?.defaultLocale
  )) {
    const value = manifest.locales?.[candidate];
    if (!value) {
      continue;
    }
    const resolved = pick(value);
    if (resolved) {
      return resolved;
    }
  }
  return;
}

export interface PluginSettingDisplayText {
  description?: string;
  enumDescriptions?: readonly string[];
  label: string;
  placeholder?: string;
}

/** label 缺省 = key 去掉 `<pluginId>.` 前缀后的全部剩余段（避免尾段撞名）。 */
export function defaultPluginSettingLabel(
  pluginId: string,
  key: string
): string {
  const prefix = `${pluginId}.`;
  return key.startsWith(prefix) ? key.slice(prefix.length) : key;
}

export function resolvePluginSettingDisplay(
  manifest: PluginManifest,
  key: string,
  locale: string
): PluginSettingDisplayText {
  const property = manifest.configuration?.properties[key];
  const description =
    resolveFromLocales(
      manifest,
      locale,
      (messages) => messages.settings?.[key]?.description
    ) ?? property?.description;
  const placeholder =
    resolveFromLocales(
      manifest,
      locale,
      (messages) => messages.settings?.[key]?.placeholder
    ) ?? property?.placeholder;
  const localeEnumDescriptions = resolveArrayFromLocales(
    manifest,
    locale,
    (messages) => messages.settings?.[key]?.enumDescriptions
  );
  // locale 侧 enumDescriptions 未与 manifest enum 做等长校验；UI 按下标映射到 enum 值，
  // 长度不符会导致下标错位（标签指向错误的枚举值）。忽略并回落 manifest，而不是直接采用。
  const enumDescriptions =
    (localeEnumDescriptions &&
    property?.enum &&
    localeEnumDescriptions.length !== property.enum.length
      ? undefined
      : localeEnumDescriptions) ?? property?.enumDescriptions;
  return {
    label:
      resolveFromLocales(
        manifest,
        locale,
        (messages) => messages.settings?.[key]?.label
      ) ?? defaultPluginSettingLabel(manifest.id, key),
    ...(description ? { description } : {}),
    ...(enumDescriptions ? { enumDescriptions } : {}),
    ...(placeholder ? { placeholder } : {}),
  };
}

/** 设置导航插件项 label：configuration.title ?? 插件显示名（后者走 manifest i18n）。 */
export function resolvePluginConfigurationTitle(
  entry: PluginRegistryEntry,
  locale: string
): string {
  return (
    entry.manifest.configuration?.title ??
    resolvePluginDisplay(entry, locale).name
  );
}
