import { APPKIT_KEYCODE, GHOSTTY_MODS } from "@shared/terminal-appkit-keys.ts";

/**
 * Composer 打开期间仍要送达 agent TUI 的控制键 → 真实按键事件。
 *
 * - Ctrl+C：始终透传（打断）
 * - 空草稿且无附件：方向键 / Tab / Shift+Tab / Enter 透传（TUI 菜单）
 * - Esc：由组件关闭路径处理，不透传
 * - 返回 null = composer 自己消费（正常编辑 / 发送 / 关闭）
 */
export interface ComposerPassthroughKeyPress {
  keycode: number;
  mods?: number | undefined;
}

export function passthroughKeyPressForKey(input: {
  altKey: boolean;
  /** Empty draft AND no attachments — see structured composer keyboard bridge. */
  empty: boolean;
  ctrlKey: boolean;
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
  if (input.ctrlKey || !input.empty) {
    return null;
  }

  switch (input.key) {
    case "ArrowUp":
      return { keycode: APPKIT_KEYCODE.arrowUp };
    case "ArrowDown":
      return { keycode: APPKIT_KEYCODE.arrowDown };
    case "ArrowLeft":
      return { keycode: APPKIT_KEYCODE.arrowLeft };
    case "ArrowRight":
      return { keycode: APPKIT_KEYCODE.arrowRight };
    case "Tab":
      return input.shiftKey
        ? { keycode: APPKIT_KEYCODE.tab, mods: GHOSTTY_MODS.shift }
        : { keycode: APPKIT_KEYCODE.tab };
    case "Enter":
      if (input.shiftKey) {
        return null;
      }
      return { keycode: APPKIT_KEYCODE.return };
    default:
      return null;
  }
}
