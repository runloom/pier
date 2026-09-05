import type { UserKeymapEntry } from "./contracts/preferences.ts";

/**
 * Default chords follow the focused surface:
 * - Terminal: Ghostty / iTerm (split, new tab; do not steal Cmd+C/V/K).
 * - Code editor: VS Code Mac (next occurrence, multi-cursor, find).
 * - Workbench-only actions stay global (palette, quick open, close, zoom).
 */
export type SharedKeybindingScope =
  | "global"
  | `overlay:${string}`
  | `panel:${string}`;

export interface SharedKeybindingInput {
  readonly commandId: string;
  readonly keys: string;
  readonly scope?: SharedKeybindingScope;
}

const TAB_FOCUS_KEYMAP: readonly SharedKeybindingInput[] = Array.from(
  { length: 9 },
  (_, offset) => offset + 1
).flatMap((index) => [
  {
    commandId: `pier.panel.focusTab${index}`,
    keys: `Mod+Digit${index}`,
    scope: "global",
  },
  {
    commandId: `pier.panel.focusTab${index}`,
    keys: `Mod+Numpad${index}`,
    scope: "global",
  },
]);

export const DEFAULT_KEYMAP: readonly SharedKeybindingInput[] = [
  {
    commandId: "pier.panel.newTerminal",
    keys: "Mod+KeyT",
    scope: "global",
  },
  {
    commandId: "pier.panel.closeActive",
    keys: "Mod+KeyW",
    scope: "global",
  },
  {
    // Cmd+N 打开当前 group 的"新建..."弹层, 不再直开新窗口;
    // 新窗口通过命令面板 / "新建..." 弹层内的 New Window 条目触发。
    commandId: "pier.panel.openCreateMenu",
    keys: "Mod+KeyN",
    scope: "global",
  },
  {
    commandId: "pier.run.rerunTask",
    keys: "Mod+Alt+KeyR",
    scope: "global",
  },
  {
    commandId: "pier.agent.new",
    keys: "Mod+Shift+KeyA",
    scope: "global",
  },
  {
    // L4 零选择：跳到下一个需要你处理的（快捷键 + 命令面板；不嵌列表假行）
    commandId: "pier.agents.focusWaiting",
    keys: "Mod+Shift+KeyY",
    scope: "global",
  },
  {
    // Files 编辑器「选中全部出现」在 panel 作用域使用同一和弦，文件面板聚焦时优先。
    commandId: "pier.agents.list",
    keys: "Mod+Shift+KeyL",
    scope: "global",
  },
  {
    commandId: "pier.commandPalette.toggle",
    keys: "Mod+Shift+KeyP",
    scope: "global",
  },
  // Preview overlay is blocking; host chrome must still resolve.
  {
    commandId: "pier.commandPalette.toggle",
    keys: "Mod+Shift+KeyP",
    scope: "overlay:content-preview",
  },
  {
    commandId: "pier.files.quickOpen",
    keys: "Mod+KeyP",
    scope: "global",
  },
  {
    commandId: "pier.files.searchContents",
    keys: "Mod+Shift+KeyF",
    scope: "global",
  },

  {
    // 不用 Mod+Shift+Enter：与增强输入/聊天「换行」撞车。M ≈ Maximize。
    commandId: "pier.panel.toggleMaximized",
    keys: "Mod+Shift+KeyM",
    scope: "global",
  },
  {
    commandId: "pier.terminal.openDebugWindow",
    keys: "Ctrl+Shift+KeyD",
    scope: "global",
  },
  {
    commandId: "pier.find",
    keys: "Mod+KeyF",
    scope: "global",
  },
  {
    commandId: "pier.findNext",
    keys: "Mod+KeyG",
    scope: "global",
  },
  {
    commandId: "pier.findPrev",
    keys: "Mod+Shift+KeyG",
    scope: "global",
  },
  {
    commandId: "pier.terminal.openAgentComposer",
    keys: "Mod+Shift+KeyI",
    scope: "panel:terminal",
  },
  // composerAttach shares ⌘⇧A with pier.agent.new: when Rich Input is focused,
  // use-keybindings steals the chord for attach; otherwise agent.new runs.
  // Binding kept so settings / command palette can show the shortcut.
  {
    commandId: "pier.terminal.composerAttach",
    keys: "Mod+Shift+KeyA",
    scope: "global",
  },
  {
    commandId: "pier.settings.open",
    keys: "Mod+Comma",
    scope: "global",
  },
  // Preview overlay is blocking; host chrome must still resolve.
  {
    commandId: "pier.settings.open",
    keys: "Mod+Comma",
    scope: "overlay:content-preview",
  },
  {
    // 打开/关闭消息中心铃铛 Popover（无独立 dockview panel）。
    commandId: "pier.notifications.open",
    keys: "Mod+Shift+KeyN",
    scope: "global",
  },
  {
    commandId: "pier.view.zoomIn",
    keys: "Mod+Equal",
    scope: "global",
  },
  {
    commandId: "pier.view.zoomIn",
    keys: "Mod+Shift+Equal",
    scope: "global",
  },
  {
    commandId: "pier.view.zoomOut",
    keys: "Mod+Minus",
    scope: "global",
  },
  {
    commandId: "pier.view.resetZoom",
    keys: "Mod+Digit0",
    scope: "global",
  },
  {
    commandId: "pier.view.resetZoom",
    keys: "Mod+Numpad0",
    scope: "global",
  },
  ...TAB_FOCUS_KEYMAP,
  {
    commandId: "pier.panel.splitRight",
    keys: "Mod+KeyD",
    scope: "panel:terminal",
  },
  {
    commandId: "pier.panel.splitDown",
    keys: "Mod+Shift+KeyD",
    scope: "panel:terminal",
  },
  {
    commandId: "pier.panel.focusNextTab",
    keys: "Mod+Shift+BracketRight",
    scope: "global",
  },
  {
    commandId: "pier.panel.focusPrevTab",
    keys: "Mod+Shift+BracketLeft",
    scope: "global",
  },
  {
    commandId: "pier.panel.focusUp",
    keys: "Mod+Alt+ArrowUp",
    scope: "global",
  },
  {
    commandId: "pier.panel.focusDown",
    keys: "Mod+Alt+ArrowDown",
    scope: "global",
  },
  {
    commandId: "pier.panel.focusLeft",
    keys: "Mod+Alt+ArrowLeft",
    scope: "global",
  },
  {
    commandId: "pier.panel.focusRight",
    keys: "Mod+Alt+ArrowRight",
    scope: "global",
  },
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
  {
    commandId: "pier.view.toggleSideTree",
    keys: "Mod+KeyB",
    scope: "global",
  },
  {
    commandId: "pier.files.save",
    keys: "Mod+KeyS",
    scope: "panel:pier.files.filePanel",
  },
  {
    commandId: "pier.files.saveAs",
    keys: "Mod+Shift+KeyS",
    scope: "panel:pier.files.filePanel",
  },
  {
    commandId: "pier.files.saveAll",
    keys: "Mod+Alt+KeyS",
    scope: "panel:pier.files.filePanel",
  },
  {
    // VS Code Mac: copyFilePath ⌥⌘C / copyRelativeFilePath ⇧⌥⌘C.
    // 「复制路径和所选行」不能再用 ⌥⌘C：同一 panel scope 下和弦只能命中一条命令。
    commandId: "pier.files.copyPath",
    keys: "Mod+Alt+KeyC",
    scope: "panel:pier.files.filePanel",
  },
  {
    commandId: "pier.files.copyRelativePath",
    keys: "Mod+Alt+Shift+KeyC",
    scope: "panel:pier.files.filePanel",
  },
  {
    commandId: "pier.files.copyPathWithRange",
    keys: "Mod+Alt+KeyL",
    scope: "panel:pier.files.filePanel",
  },
  {
    commandId: "pier.git.review.copyPath",
    keys: "Mod+Alt+KeyC",
    scope: "panel:pier.git.changes",
  },
  {
    commandId: "pier.git.review.copyRelativePath",
    keys: "Mod+Alt+Shift+KeyC",
    scope: "panel:pier.git.changes",
  },
  {
    commandId: "pier.git.review.copyPathWithRange",
    keys: "Mod+Alt+KeyL",
    scope: "panel:pier.git.changes",
  },
  {
    commandId: "pier.files.search.copyPath",
    keys: "Mod+Alt+KeyC",
    scope: "panel:pier.files.searchPanel",
  },
  {
    commandId: "pier.files.search.copyRelativePath",
    keys: "Mod+Alt+Shift+KeyC",
    scope: "panel:pier.files.searchPanel",
  },
  {
    commandId: "pier.files.editor.goToLine",
    keys: "Ctrl+KeyG",
    scope: "panel:pier.files.filePanel",
  },
  {
    commandId: "pier.files.editor.showHover",
    keys: "Mod+KeyI",
    scope: "panel:pier.files.filePanel",
  },
  {
    commandId: "pier.files.changes.next",
    keys: "Alt+F5",
    scope: "panel:pier.files.filePanel",
  },
  {
    commandId: "pier.files.changes.previous",
    keys: "Alt+Shift+F5",
    scope: "panel:pier.files.filePanel",
  },
  {
    commandId: "pier.files.editor.selectNextOccurrence",
    keys: "Mod+KeyD",
    scope: "panel:pier.files.filePanel",
  },
  {
    // 文件面板覆盖全局 pier.agents.list 的同一和弦（VS Code 习惯：⌘⇧L 多光标）。
    commandId: "pier.files.editor.selectAllOccurrences",
    keys: "Mod+Shift+KeyL",
    scope: "panel:pier.files.filePanel",
  },
  {
    commandId: "pier.files.editor.addCursorAbove",
    keys: "Mod+Alt+ArrowUp",
    scope: "panel:pier.files.filePanel",
  },
  {
    commandId: "pier.files.editor.addCursorBelow",
    keys: "Mod+Alt+ArrowDown",
    scope: "panel:pier.files.filePanel",
  },
];

const CODE_TO_ELECTRON: Readonly<Record<string, string>> = {
  ArrowDown: "Down",
  ArrowLeft: "Left",
  ArrowRight: "Right",
  ArrowUp: "Up",
  Backquote: "`",
  Backslash: "\\",
  Backspace: "Backspace",
  BracketLeft: "[",
  BracketRight: "]",
  Comma: ",",
  Delete: "Delete",
  Enter: "Return",
  Equal: "=",
  Escape: "Escape",
  Minus: "-",
  Numpad0: "num0",
  Period: ".",
  Quote: "'",
  Semicolon: ";",
  Slash: "/",
  Space: "Space",
  Tab: "Tab",
};

export function keybindingToElectronAccelerator(keys: string): string {
  const parts = keys.split("+").filter(Boolean);
  const result: string[] = [];
  for (const part of parts) {
    switch (part) {
      case "Mod":
        result.push("CmdOrCtrl");
        break;
      case "Ctrl":
        result.push("Control");
        break;
      case "Alt":
      case "Shift":
        result.push(part);
        break;
      default:
        if (part.startsWith("Key")) {
          result.push(part.slice(3));
        } else if (part.startsWith("Digit")) {
          result.push(part.slice(5));
        } else {
          result.push(CODE_TO_ELECTRON[part] ?? part);
        }
        break;
    }
  }
  return result.join("+");
}

export function isNativeTerminalRoutedScope(
  scope: SharedKeybindingScope | undefined
): boolean {
  const resolved = scope ?? "global";
  return resolved === "global" || resolved === "panel:terminal";
}

export function chordHasNonGlobalBinding(
  keys: string,
  userKeymap: readonly UserKeymapEntry[] = []
): boolean {
  const unbound = new Set(
    userKeymap
      .filter((entry) => entry.commandId.startsWith("-"))
      .map((entry) => entry.commandId.slice(1))
  );
  for (const entry of userKeymap) {
    if (entry.commandId.startsWith("-") || entry.keys !== keys) {
      continue;
    }
    if ((entry.scope ?? "global") !== "global") {
      return true;
    }
  }
  return DEFAULT_KEYMAP.some(
    (binding) =>
      binding.keys === keys &&
      (binding.scope ?? "global") !== "global" &&
      !unbound.has(binding.commandId)
  );
}

export function firstBindingForCommand(
  commandId: string,
  userKeymap: readonly UserKeymapEntry[] = []
): SharedKeybindingInput | undefined {
  const unbindId = `-${commandId}`;
  const userBinding = userKeymap.find((entry) => entry.commandId === commandId);
  if (userBinding?.keys) {
    return {
      commandId,
      keys: userBinding.keys,
      scope: (userBinding.scope ?? "global") as SharedKeybindingScope,
    };
  }
  if (userKeymap.some((entry) => entry.commandId === unbindId)) {
    return;
  }
  return DEFAULT_KEYMAP.find((entry) => entry.commandId === commandId);
}

export function firstAcceleratorForCommand(
  commandId: string,
  userKeymap: readonly UserKeymapEntry[] = []
): string | undefined {
  const binding = firstBindingForCommand(commandId, userKeymap);
  return binding ? keybindingToElectronAccelerator(binding.keys) : undefined;
}
