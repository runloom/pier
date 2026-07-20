import { APPKIT_KEYCODE, GHOSTTY_MODS } from "@shared/terminal-appkit-keys.ts";

/**
 * Composer 接管键盘期间仍要送达 agent TUI 的控制键 → 真实按键事件。
 * 不得走 sendText（clipboard-paste）：Esc / Ctrl+C / CSI 会被破坏或 BP 包裹。
 * 返回 null = composer 自己消费（正常编辑 / 发送路径）。
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
  if (input.metaKey) {
    return null;
  }
  if (input.ctrlKey) {
    return input.key.toLowerCase() === "c"
      ? { keycode: APPKIT_KEYCODE.c, mods: GHOSTTY_MODS.ctrl }
      : null;
  }
  if (input.key === "Escape") {
    return { keycode: APPKIT_KEYCODE.escape };
  }
  if (!input.empty) {
    return null;
  }
  switch (input.key) {
    case "ArrowUp":
      return { keycode: APPKIT_KEYCODE.arrowUp };
    case "ArrowDown":
      return { keycode: APPKIT_KEYCODE.arrowDown };
    case "ArrowRight":
      return { keycode: APPKIT_KEYCODE.arrowRight };
    case "ArrowLeft":
      return { keycode: APPKIT_KEYCODE.arrowLeft };
    case "Tab":
      return input.shiftKey
        ? { keycode: APPKIT_KEYCODE.tab, mods: GHOSTTY_MODS.shift }
        : { keycode: APPKIT_KEYCODE.tab };
    case "Enter":
      return input.shiftKey ? null : { keycode: APPKIT_KEYCODE.return };
    default:
      return null;
  }
}
