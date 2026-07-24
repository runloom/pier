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
  /** 随键附带的文本（如 Return 带 "\r"）；部分 agent TUI 只认 text。 */
  text?: string | undefined;
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
      // 与 sendTerminalText 的 submit 路径同口径：Return 必须带 text="\r"，
      // 否则部分 agent TUI 不把它当提交（见 bafabd7f / codex#28167）。
      return { keycode: APPKIT_KEYCODE.return, text: "\r" };
    default:
      return null;
  }
}
