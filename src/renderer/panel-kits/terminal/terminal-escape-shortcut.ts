import { terminalAppShortcutKeys } from "@/lib/keybindings/terminal-app-shortcuts.ts";

/**
 * 搜索等可关闭浮层打开期间，临时把裸 Escape 加入 native terminal app-shortcut
 * allowlist，否则终端占 firstResponder 时 Esc 会进 Ghostty，web 收不到。
 * 用引用计数支持同窗多个浮层并存。
 */
let escapeShortcutHolders = 0;

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
