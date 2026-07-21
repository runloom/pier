import { APPKIT_KEYCODE, GHOSTTY_MODS } from "@shared/terminal-appkit-keys.ts";

/**
 * Composer 打开期间仍要送达 agent TUI 的控制键 → 真实按键事件。
 * 仅 Ctrl+C 中断透传；Esc 由组件关闭路径处理；方向键/Tab/Enter 不再空草稿桥接。
 * 返回 null = composer 自己消费（正常编辑 / 发送 / 关闭路径）。
 */
export interface ComposerPassthroughKeyPress {
  keycode: number;
  mods?: number | undefined;
}

export function passthroughKeyPressForKey(input: {
  altKey: boolean;
  ctrlKey: boolean;
  empty: boolean;
  key: string;
  metaKey: boolean;
  shiftKey: boolean;
}): ComposerPassthroughKeyPress | null {
  if (input.metaKey || input.altKey) {
    return null;
  }
  if (input.ctrlKey && input.key.toLowerCase() === "c") {
    return { keycode: APPKIT_KEYCODE.c, mods: GHOSTTY_MODS.ctrl };
  }
  return null;
}
