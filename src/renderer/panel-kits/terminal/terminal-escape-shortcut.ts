import { terminalAppShortcutKeys } from "@/lib/keybindings/terminal-app-shortcuts.ts";

/**
 * 搜索 / 增强输入等可关闭浮层打开期间，临时把裸 Escape 加入 native terminal
 * app-shortcut allowlist，否则终端占 firstResponder 时 Esc 会进 Ghostty，web 收不到。
 * 用引用计数支持同窗多个浮层并存。
 */
let escapeShortcutHolders = 0;

/** 与 use-keybindings 一致的 NSEvent 修饰位。 */
const NS_FLAG_SHIFT = 0x2_00_00;
const NS_FLAG_CONTROL = 0x4_00_00;
const NS_FLAG_OPTION = 0x8_00_00;
const NS_FLAG_COMMAND = 0x10_00_00;

function hasNsFlag(modifierFlags: number, flag: number): boolean {
  // biome-ignore lint/suspicious/noBitwiseOperators: NSEvent.modifierFlags 位掩码
  return (modifierFlags & flag) !== 0;
}

/** Native key-forward 是否为无修饰的裸 Escape。 */
export function isBareEscapeForward(
  modifierFlags: number,
  chars: string
): boolean {
  if (
    hasNsFlag(modifierFlags, NS_FLAG_COMMAND) ||
    hasNsFlag(modifierFlags, NS_FLAG_CONTROL) ||
    hasNsFlag(modifierFlags, NS_FLAG_OPTION) ||
    hasNsFlag(modifierFlags, NS_FLAG_SHIFT)
  ) {
    return false;
  }
  return chars === "\u{1b}" || chars.toLowerCase() === "escape";
}

function syncEscapeShortcutAllowlist(): void {
  const keys = new Set(terminalAppShortcutKeys());
  if (escapeShortcutHolders > 0) {
    keys.add("Escape");
  }
  try {
    window.pier?.terminal?.setAppShortcutKeys?.([...keys].sort());
  } catch (err) {
    console.error("[terminal-escape-shortcut] setAppShortcutKeys failed:", err);
  }
}

export function acquireTerminalEscapeShortcut(): () => void {
  escapeShortcutHolders += 1;
  if (escapeShortcutHolders === 1) {
    syncEscapeShortcutAllowlist();
  }
  let released = false;
  return () => {
    if (released) {
      return;
    }
    released = true;
    escapeShortcutHolders = Math.max(0, escapeShortcutHolders - 1);
    if (escapeShortcutHolders === 0) {
      syncEscapeShortcutAllowlist();
    }
  };
}

export function resetTerminalEscapeShortcutForTests(): void {
  escapeShortcutHolders = 0;
}
