/**
 * 全局快捷键 dispatch. 挂 window capture-phase keydown 一次, 渲染 null.
 */
import { useKeyboardShortcuts } from "@/lib/keybindings/use-keybindings.ts";

export function ShellKeybindings(): null {
  useKeyboardShortcuts();
  return null;
}
