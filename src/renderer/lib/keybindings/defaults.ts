/**
 * 默认 keymap. main.tsx 启动时 keybindingRegistry.registerDefaults 一次性灌入.
 *
 * 新增条目时:
 *   1. 在 actionRegistry 注册对应 Action (id 必须与此处 commandId 一致).
 *   2. 在 i18n 加对应文案 (如有).
 */
import type { KeybindingInput } from "./types.ts";

export const DEFAULT_KEYMAP: readonly KeybindingInput[] = [
  { commandId: "pier.panel.newTab", keys: "Mod+KeyT" },
  { commandId: "pier.panel.closeActive", keys: "Mod+KeyW" },
  { commandId: "pier.window.newWindow", keys: "Mod+KeyN" },
  { commandId: "pier.commandPalette.toggle", keys: "Mod+Shift+KeyP" },
  { commandId: "pier.settings.open", keys: "Mod+Comma" },
];
