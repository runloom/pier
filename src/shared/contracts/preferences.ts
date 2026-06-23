/**
 * 主题/风格/语言 preferences schema (运行时 emission)
 */
import { z } from "zod";

export const themePreferenceSchema = z.enum(["light", "dark", "system"]);
export const resolvedThemeSchema = z.enum(["light", "dark"]);

export const stylePresetIdSchema = z.enum([
  "pierre",
  "pierre-soft",
  "catppuccin",
  "everforest",
  "github",
  "github-default",
  "github-high-contrast",
  "gruvbox-hard",
  "gruvbox-medium",
  "gruvbox-soft",
  "kanagawa",
  "vscode",
  "material",
  "min",
  "one",
  "rose-pine",
  "slack",
  "solarized",
  "vitesse",
]);

export const DEFAULT_UI_FONT_FAMILY = "";
export const DEFAULT_MONO_FONT_FAMILY = "";
export const DEFAULT_MONO_FONT_SIZE = 13;

export const projectPreferencesSchema = z.object({
  theme: themePreferenceSchema.default("system"),
  stylePresetId: stylePresetIdSchema.default("pierre"),
  language: z.enum(["zh-CN", "en"]).default("zh-CN"),
  uiFontFamily: z.string().default(DEFAULT_UI_FONT_FAMILY),
  monoFontFamily: z.string().default(DEFAULT_MONO_FONT_FAMILY),
  monoFontSize: z
    .number()
    .int()
    .min(8)
    .max(32)
    .default(DEFAULT_MONO_FONT_SIZE),
});

export type ThemePreference = z.infer<typeof themePreferenceSchema>;
export type ResolvedTheme = z.infer<typeof resolvedThemeSchema>;
export type StylePresetId = z.infer<typeof stylePresetIdSchema>;
export type ProjectPreferences = z.infer<typeof projectPreferencesSchema>;
