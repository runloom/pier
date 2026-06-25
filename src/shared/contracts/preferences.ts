/**
 * 主题/风格/语言 preferences schema (运行时 emission)
 */
import { z } from "zod";

export const themePreferenceSchema = z.enum(["light", "dark", "system"]);
export const resolvedThemeSchema = z.enum(["light", "dark"]);
export const terminalCursorStyleSchema = z.enum(["block", "bar", "underline"]);
export const terminalNewCwdPolicySchema = z.enum([
  "activeTerminal",
  "shellDefault",
]);

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
export const DEFAULT_TERMINAL_CURSOR_STYLE = "block";
export const DEFAULT_TERMINAL_CURSOR_BLINK = true;
export const DEFAULT_TERMINAL_SCROLLBACK_MB = 64;
export const DEFAULT_TERMINAL_PASTE_PROTECTION = true;
export const DEFAULT_TERMINAL_NEW_CWD_POLICY = "activeTerminal";

export const projectPreferencesSchema = z.object({
  theme: themePreferenceSchema.default("system"),
  stylePresetId: stylePresetIdSchema.default("pierre"),
  language: z.enum(["zh-CN", "en"]).default("zh-CN"),
  uiFontFamily: z.string().default(DEFAULT_UI_FONT_FAMILY),
  monoFontFamily: z.string().default(DEFAULT_MONO_FONT_FAMILY),
  monoFontSize: z.number().int().min(8).max(32).default(DEFAULT_MONO_FONT_SIZE),
  terminalCursorStyle: terminalCursorStyleSchema.default(
    DEFAULT_TERMINAL_CURSOR_STYLE
  ),
  terminalCursorBlink: z.boolean().default(DEFAULT_TERMINAL_CURSOR_BLINK),
  terminalScrollbackMb: z
    .number()
    .int()
    .min(10)
    .max(512)
    .default(DEFAULT_TERMINAL_SCROLLBACK_MB),
  terminalPasteProtection: z
    .boolean()
    .default(DEFAULT_TERMINAL_PASTE_PROTECTION),
  terminalNewCwdPolicy: terminalNewCwdPolicySchema.default(
    DEFAULT_TERMINAL_NEW_CWD_POLICY
  ),
});

export type ThemePreference = z.infer<typeof themePreferenceSchema>;
export type ResolvedTheme = z.infer<typeof resolvedThemeSchema>;
export type StylePresetId = z.infer<typeof stylePresetIdSchema>;
export type TerminalCursorStyle = z.infer<typeof terminalCursorStyleSchema>;
export type TerminalNewCwdPolicy = z.infer<typeof terminalNewCwdPolicySchema>;
export type ProjectPreferences = z.infer<typeof projectPreferencesSchema>;
