/**
 * 主题/风格/语言 preferences schema (运行时 emission)
 */
import { z } from "zod";
import {
  agentKindSchema,
  agentPermissionModePreferenceSchema,
} from "./agent.ts";
import {
  agentAttentionSettingsSchema,
  DEFAULT_AGENT_ATTENTION_SETTINGS,
} from "./agent-attention.ts";

export const themePreferenceSchema = z.enum(["light", "dark", "system"]);
export const resolvedThemeSchema = z.enum(["light", "dark"]);
export const terminalCursorStyleSchema = z.enum(["block", "bar", "underline"]);
export const terminalNewCwdPolicySchema = z.enum([
  "activeTerminal",
  "shellDefault",
]);
export const appQuitConfirmationModeSchema = z.enum([
  "always",
  "hasActivity",
  "never",
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
export const DEFAULT_AGENT_COMPOSER_ENABLED = true;
export const DEFAULT_TERMINAL_NEW_CWD_POLICY = "activeTerminal";
export const DEFAULT_APP_QUIT_CONFIRMATION_MODE = "hasActivity";
export const DEFAULT_WINDOW_ZOOM_LEVEL = 0;
export const MIN_WINDOW_ZOOM_LEVEL = -3;
export const MAX_WINDOW_ZOOM_LEVEL = 5;
export const DEFAULT_GIT_AUTO_FETCH_ENABLED = true;
export const DEFAULT_GIT_AUTO_FETCH_INTERVAL_MINUTES = 5;

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
  confirmOnQuit: appQuitConfirmationModeSchema.default(
    DEFAULT_APP_QUIT_CONFIRMATION_MODE
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
  agentPermissionMode: agentPermissionModePreferenceSchema.default("manual"),
  agentDefaultArgs: z.partialRecord(agentKindSchema, z.string()).default({}),
  agentDefaultEnv: z
    .partialRecord(agentKindSchema, z.record(z.string(), z.string()))
    .default({}),
  agentCommandOverrides: z
    .partialRecord(agentKindSchema, z.string())
    .default({}),
  agentComposerEnabled: z.boolean().default(DEFAULT_AGENT_COMPOSER_ENABLED),
  worktreeRootPath: z.string().max(1024).default(""),
  /** 是否向已安装 agent 的官方 hook 配置里注入 Pier agent 状态 hook (opt-out, 默认开; 关闭即卸载)。 */
  agentStatusHooks: z.boolean().default(true),
  agentAttention: agentAttentionSettingsSchema.default(
    DEFAULT_AGENT_ATTENTION_SETTINGS
  ),
  gitAutoFetchEnabled: z.boolean().default(DEFAULT_GIT_AUTO_FETCH_ENABLED),
  gitAutoFetchIntervalMinutes: z
    .number()
    .int()
    .min(1)
    .max(120)
    .default(DEFAULT_GIT_AUTO_FETCH_INTERVAL_MINUTES),
});

export type ThemePreference = z.infer<typeof themePreferenceSchema>;
export type ResolvedTheme = z.infer<typeof resolvedThemeSchema>;
export type StylePresetId = z.infer<typeof stylePresetIdSchema>;
export type TerminalCursorStyle = z.infer<typeof terminalCursorStyleSchema>;
export type TerminalNewCwdPolicy = z.infer<typeof terminalNewCwdPolicySchema>;
export type AppQuitConfirmationMode = z.infer<
  typeof appQuitConfirmationModeSchema
>;
export type KeybindingScopePreference = z.infer<typeof keybindingScopeSchema>;
export type UserKeymapEntry = z.infer<typeof userKeymapEntrySchema>;
export type ProjectPreferences = z.infer<typeof projectPreferencesSchema>;
