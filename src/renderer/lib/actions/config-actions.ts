import type {
  StylePresetId,
  ThemePreference,
} from "@shared/contracts/preferences.ts";
import i18next from "i18next";
import { Languages, Paintbrush, Palette } from "lucide-react";
import { registerActionContributions } from "@/lib/actions/contribution-runtime.ts";
import type { ActionContribution } from "@/lib/actions/contribution-types.ts";
import {
  rendererActionContributionRuntime,
  resolveI18nAliases,
} from "@/lib/actions/renderer-action-runtime.ts";
import { useCommandPaletteController } from "@/lib/command-palette/controller.ts";
import { LOCALE_OPTIONS } from "@/pages/settings/data/locales.ts";
import { STYLE_PRESET_OPTIONS } from "@/pages/settings/data/style-presets.ts";
import { type Language, useLocaleStore } from "@/stores/locale.store.ts";
import { applyThemeVisual, useThemeStore } from "@/stores/theme.store.ts";

const THEME_OPTIONS_DATA = [
  {
    id: "light",
    labelKey: "settings.theme.light",
  },
  {
    id: "dark",
    labelKey: "settings.theme.dark",
  },
  {
    id: "system",
    labelKey: "settings.theme.system",
  },
] as const;

function themeAliasesKey(value: ThemePreference): string {
  return `commandPalette.aliases.theme.${value}`;
}

function stylePresetAliasesKey(value: StylePresetId): string {
  return `commandPalette.aliases.stylePreset.${value}`;
}

function localeAliasesKey(value: Language): string {
  return `commandPalette.aliases.locale.${value}`;
}

function openThemeQuickPick() {
  const store = useThemeStore.getState();
  const originalTheme = store.theme;
  const originalPreset = store.stylePresetId;

  useCommandPaletteController.getState().openQuickPick({
    title: i18next.t("commandPalette.action.selectTheme"),
    placeholder: i18next.t("commandPalette.placeholder.theme"),
    items: THEME_OPTIONS_DATA.map((opt) => ({
      aliases: resolveI18nAliases(themeAliasesKey(opt.id)),
      checked: opt.id === originalTheme,
      id: opt.id,
      label: i18next.t(opt.labelKey),
    })),
    onChangeSelection(item) {
      applyThemeVisual(item.id as ThemePreference, originalPreset);
    },
    async onAccept(item) {
      await store.setTheme(item.id as ThemePreference);
    },
    onDismiss() {
      applyThemeVisual(originalTheme, originalPreset);
    },
  });
}

function openStylePresetQuickPick() {
  const store = useThemeStore.getState();
  const originalTheme = store.theme;
  const originalPreset = store.stylePresetId;

  useCommandPaletteController.getState().openQuickPick({
    title: i18next.t("commandPalette.action.selectStyle"),
    placeholder: i18next.t("commandPalette.placeholder.style"),
    items: STYLE_PRESET_OPTIONS.map((opt) => ({
      aliases: resolveI18nAliases(stylePresetAliasesKey(opt.value)),
      checked: opt.value === originalPreset,
      id: opt.value,
      label: i18next.t(opt.labelKey),
    })),
    onChangeSelection(item) {
      applyThemeVisual(originalTheme, item.id as StylePresetId);
    },
    async onAccept(item) {
      await store.setStylePreset(item.id as StylePresetId);
    },
    onDismiss() {
      applyThemeVisual(originalTheme, originalPreset);
    },
  });
}

function openLocaleQuickPick() {
  const ctrl = useCommandPaletteController.getState();
  const currentLanguage = useLocaleStore.getState().language;

  ctrl.openQuickPick({
    title: i18next.t("commandPalette.action.selectLanguage"),
    placeholder: i18next.t("commandPalette.placeholder.language"),
    items: LOCALE_OPTIONS.map((opt) => ({
      aliases: resolveI18nAliases(localeAliasesKey(opt.value)),
      checked: opt.value === currentLanguage,
      id: `locale:${opt.value}`,
      label: i18next.t(`settings.locale.${opt.value}`),
    })),
    onAccept: (item) => {
      const next = item.id.replace("locale:", "") as Language;
      useLocaleStore
        .getState()
        .setLanguage(next)
        .catch(() => undefined);
    },
  });
}

export const CONFIG_ACTION_CONTRIBUTIONS: readonly ActionContribution[] = [
  {
    categoryKey: "settings",
    group: "5_appearance",
    handler: openThemeQuickPick,
    iconComponent: Palette,
    id: "pier.config.theme",
    sortOrder: 10,
    surfaces: ["command-palette"],
    titleKey: "commandPalette.action.selectTheme",
  },
  {
    categoryKey: "settings",
    group: "5_appearance",
    handler: openStylePresetQuickPick,
    iconComponent: Paintbrush,
    id: "pier.config.stylePreset",
    sortOrder: 11,
    surfaces: ["command-palette"],
    titleKey: "commandPalette.action.selectStyle",
  },
  {
    categoryKey: "settings",
    group: "5_appearance",
    handler: openLocaleQuickPick,
    iconComponent: Languages,
    id: "pier.config.locale",
    sortOrder: 20,
    surfaces: ["command-palette"],
    titleKey: "commandPalette.action.selectLanguage",
  },
];

export function registerConfigActions(): () => void {
  const disposers = registerActionContributions(
    CONFIG_ACTION_CONTRIBUTIONS,
    rendererActionContributionRuntime
  );

  return () => {
    for (const dispose of disposers) {
      dispose();
    }
  };
}
