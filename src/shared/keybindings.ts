import type { UserKeymapEntry } from "./contracts/preferences.ts";

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
    // L4 零选择：跳到下一个 Needs you（仅快捷键；不进命令面板、不嵌列表假行）
    commandId: "pier.agents.focusWaiting",
    keys: "Mod+Shift+KeyY",
    scope: "global",
  },
  {
    commandId: "pier.commandPalette.toggle",
    keys: "Mod+Shift+KeyP",
    scope: "global",
  },
  {
    commandId: "pier.files.quickOpen",
    keys: "Mod+KeyP",
    scope: "global",
  },

  {
    commandId: "pier.panel.toggleMaximized",
    keys: "Mod+Shift+Enter",
    scope: "global",
  },
  {
    commandId: "pier.terminal.openDebugWindow",
    keys: "Ctrl+Shift+KeyD",
    scope: "global",
  },
  {
    commandId: "pier.terminal.search",
    keys: "Mod+KeyF",
    scope: "global",
  },
  {
    commandId: "pier.terminal.openAgentComposer",
    keys: "Mod+Shift+KeyI",
    scope: "global",
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
    scope: "global",
  },
  {
    commandId: "pier.panel.splitDown",
    keys: "Mod+Shift+KeyD",
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

export function firstAcceleratorForCommand(
  commandId: string,
  userKeymap: readonly UserKeymapEntry[] = []
): string | undefined {
  const unbindId = `-${commandId}`;
  const userBinding = userKeymap.find((entry) => entry.commandId === commandId);
  if (userBinding?.keys) {
    return keybindingToElectronAccelerator(userBinding.keys);
  }
  if (userKeymap.some((entry) => entry.commandId === unbindId)) {
    return;
  }
  const defaultBinding = DEFAULT_KEYMAP.find(
    (entry) => entry.commandId === commandId
  );
  return defaultBinding
    ? keybindingToElectronAccelerator(defaultBinding.keys)
    : undefined;
}
