/**
 * 主题 / 风格 / 语言 三条 command palette action: preview/accept/dismiss pattern
 *
 *   - 箭头键 / hover → onChangeSelection: 仅改 DOM (applyThemeVisual, 不打 IPC)
 *   - Enter / 点击  → onAccept: 走 store.setX() IPC 持久化
 *   - Esc / 遮罩    → onDismiss: 调 applyThemeVisual(original) 还原 DOM
 *
 * locale 不挂 onChangeSelection: 切语言会改 i18next 全局态, 面板自身的 label
 * 会跟着 flicker, 体验差; 仅在 accept 时切换。
 */
import type {
  StylePresetId,
  ThemePreference,
} from "@shared/contracts/preferences.ts";
import i18next from "i18next";
import { Languages, Paintbrush, Palette } from "lucide-react";
import { actionRegistry } from "@/lib/actions/registry.ts";
import { useCommandPaletteController } from "@/lib/command-palette/controller.ts";
import { LOCALE_OPTIONS } from "@/pages/settings/data/locales.ts";
import { STYLE_PRESET_OPTIONS } from "@/pages/settings/data/style-presets.ts";
import { applyThemeVisual, useThemeStore } from "@/stores/theme.store.ts";
import { type Language, useLocaleStore } from "@/stores/locale.store.ts";

const THEME_OPTIONS_DATA = [
  { id: "light", labelKey: "settings.theme.light" },
  { id: "dark", labelKey: "settings.theme.dark" },
  { id: "system", labelKey: "settings.theme.system" },
] as const;

const LOCALE_KEYWORDS: Record<Language, readonly string[]> = {
  "zh-CN": ["zh", "chinese", "中文", "简体"],
  en: ["en", "english", "英文"],
};

export function registerConfigActions(): () => void {
  const disposers: Array<() => void> = [];

  // ── Theme ──────────────────────────────────────────────────────────────
  disposers.push(
    actionRegistry.register({
      id: "pier.config.theme",
      category: "Settings",
      title: () => i18next.t("commandPalette.action.selectTheme"),
      surfaces: ["command-palette"],
      metadata: {
        iconComponent: Palette,
        sortOrder: 10,
        keywords: ["theme", "主题", "dark", "light", "深色", "浅色"],
      },
      handler: () => {
        const store = useThemeStore.getState();
        const originalTheme = store.theme;
        const originalPreset = store.stylePresetId;

        useCommandPaletteController.getState().openQuickPick({
          title: i18next.t("commandPalette.action.selectTheme"),
          placeholder: i18next.t("commandPalette.placeholder.theme"),
          items: THEME_OPTIONS_DATA.map((opt) => ({
            id: opt.id,
            label: i18next.t(opt.labelKey),
            checked: opt.id === originalTheme,
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
      },
    }),
  );

  // ── Style preset ──────────────────────────────────────────────────────
  disposers.push(
    actionRegistry.register({
      id: "pier.config.stylePreset",
      category: "Settings",
      title: () => i18next.t("commandPalette.action.selectStyle"),
      surfaces: ["command-palette"],
      metadata: {
        iconComponent: Paintbrush,
        sortOrder: 11,
        keywords: ["style", "风格", "theme", "preset", "配色"],
      },
      handler: () => {
        const store = useThemeStore.getState();
        const originalTheme = store.theme;
        const originalPreset = store.stylePresetId;

        useCommandPaletteController.getState().openQuickPick({
          title: i18next.t("commandPalette.action.selectStyle"),
          placeholder: i18next.t("commandPalette.placeholder.style"),
          items: STYLE_PRESET_OPTIONS.map((opt) => ({
            id: opt.value,
            label: i18next.t(opt.labelKey),
            checked: opt.value === originalPreset,
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
      },
    }),
  );

  // ── Locale (no preview) ───────────────────────────────────────────────
  disposers.push(
    actionRegistry.register({
      id: "pier.config.locale",
      category: "Settings",
      title: () => i18next.t("commandPalette.action.selectLanguage"),
      surfaces: ["command-palette"],
      metadata: {
        iconComponent: Languages,
        sortOrder: 20,
        keywords: ["language", "locale", "i18n", "语言"],
      },
      handler: () => {
        const ctrl = useCommandPaletteController.getState();
        const currentLanguage = useLocaleStore.getState().language;

        ctrl.openQuickPick({
          title: i18next.t("commandPalette.action.selectLanguage"),
          placeholder: i18next.t("commandPalette.placeholder.language"),
          items: LOCALE_OPTIONS.map((opt) => ({
            id: `locale:${opt.value}`,
            label: i18next.t(`settings.locale.${opt.value}`),
            keywords: LOCALE_KEYWORDS[opt.value],
            checked: opt.value === currentLanguage,
          })),
          onAccept: (item) => {
            const next = item.id.replace("locale:", "") as Language;
            useLocaleStore
              .getState()
              .setLanguage(next)
              .catch(() => undefined);
          },
        });
      },
    }),
  );

  return () => {
    for (const dispose of disposers) {
      dispose();
    }
  };
}
