/**
 * 默认 keymap. main.tsx 启动时 keybindingRegistry.registerDefaults 一次性灌入.
 *
 * 新增条目时:
 *   1. 在 actionRegistry 注册对应 Action (id 必须与此处 commandId 一致).
 *   2. 在 i18n 加对应文案 (如有).
 */
import type { KeybindingInput } from "./types.ts";

export const DEFAULT_KEYMAP: readonly KeybindingInput[] = [
  { commandId: "pier.panel.newTab", keys: "Mod+KeyT", scope: "global" },
  { commandId: "pier.panel.closeActive", keys: "Mod+KeyW", scope: "global" },
  { commandId: "pier.window.newWindow", keys: "Mod+KeyN", scope: "global" },
  {
    commandId: "pier.panel.newTerminal",
    keys: "Mod+Backquote",
    scope: "global",
  },
  {
    commandId: "pier.commandPalette.toggle",
    keys: "Mod+Shift+KeyP",
    scope: "global",
  },
  { commandId: "pier.settings.open", keys: "Mod+Comma", scope: "global" },
  // Split — splitLeft / splitUp 不绑默认 (用户可自定义)
  { commandId: "pier.panel.splitRight", keys: "Mod+KeyD", scope: "global" },
  {
    commandId: "pier.panel.splitDown",
    keys: "Mod+Shift+KeyD",
    scope: "global",
  },
  // Focus — Ctrl+Shift+方向键 (mac 上 = 独立 Ctrl, 非 mac 上 = Mod 等价)
  {
    commandId: "pier.panel.focusUp",
    keys: "Ctrl+Shift+ArrowUp",
    scope: "global",
  },
  {
    commandId: "pier.panel.focusDown",
    keys: "Ctrl+Shift+ArrowDown",
    scope: "global",
  },
  {
    commandId: "pier.panel.focusLeft",
    keys: "Ctrl+Shift+ArrowLeft",
    scope: "global",
  },
  {
    commandId: "pier.panel.focusRight",
    keys: "Ctrl+Shift+ArrowRight",
    scope: "global",
  },
];
