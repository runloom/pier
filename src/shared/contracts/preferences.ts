/**
 * 主题/风格/语言 preferences schema (运行时 emission)
 */
import { z } from "zod";
import { agentKindSchema } from "./agent.ts";

export const themePreferenceSchema = z.enum(["light", "dark", "system"]);
export const resolvedThemeSchema = z.enum(["light", "dark"]);
export const terminalCursorStyleSchema = z.enum(["block", "bar", "underline"]);
export const terminalNewCwdPolicySchema = z.enum([
  "activeTerminal",
  "shellDefault",
]);
export const keybindingScopeSchema = z.union([
  z.literal("global"),
  z.string().regex(/^(panel|overlay):[A-Za-z0-9._:-]+$/),
]);

export const userKeymapEntrySchema = z
  .object({
    commandId: z.string().min(1).max(128),
    keys: z.string().max(128),
    scope: keybindingScopeSchema.default("global"),
  })
  .refine((entry) => entry.commandId.startsWith("-") || entry.keys !== "", {
    message: "keys is required for keybinding entries",
    path: ["keys"],
  });

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
export const DEFAULT_WINDOW_ZOOM_LEVEL = 0;
export const MIN_WINDOW_ZOOM_LEVEL = -3;
export const MAX_WINDOW_ZOOM_LEVEL = 5;

export const projectPreferencesSchema = z.object({
  theme: themePreferenceSchema.default("system"),
  stylePresetId: stylePresetIdSchema.default("pierre"),
  language: z.enum(["system", "zh-CN", "en"]).default("system"),
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
  windowZoomLevel: z
    .number()
    .int()
    .min(MIN_WINDOW_ZOOM_LEVEL)
    .max(MAX_WINDOW_ZOOM_LEVEL)
    .default(DEFAULT_WINDOW_ZOOM_LEVEL),
  userKeymap: z.array(userKeymapEntrySchema).max(256).default([]),
  defaultAgentId: z
    .union([agentKindSchema, z.literal("blank")])
    .nullable()
    .default(null),
  disabledAgentIds: z.array(agentKindSchema).default([]),
  agentDefaultArgs: z.record(z.string(), z.string()).default({}),
  agentDefaultEnv: z
    .record(z.string(), z.record(z.string(), z.string()))
    .default({}),
});

export type ThemePreference = z.infer<typeof themePreferenceSchema>;
export type ResolvedTheme = z.infer<typeof resolvedThemeSchema>;
export type StylePresetId = z.infer<typeof stylePresetIdSchema>;
export type TerminalCursorStyle = z.infer<typeof terminalCursorStyleSchema>;
export type TerminalNewCwdPolicy = z.infer<typeof terminalNewCwdPolicySchema>;
export type KeybindingScopePreference = z.infer<typeof keybindingScopeSchema>;
export type UserKeymapEntry = z.infer<typeof userKeymapEntrySchema>;
export type ProjectPreferences = z.infer<typeof projectPreferencesSchema>;
