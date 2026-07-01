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

function interpolateMessage(
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
): PluginContributionDisplayText {
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
