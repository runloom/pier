/**
 * DSL 解析: "Mod+Shift+KeyP" → KeyChord.
 *
 * 修饰符 token 只接受 Mod / Alt / Shift 三种 (避免 Cmd 在 Linux 上的歧义).
 * key 主体直接是 KeyboardEvent.code 字面量 ("KeyP" / "Digit1" / "Escape" / ...).
 */
import type { KeyChord } from "./types.ts";

export interface ParsedCommandId {
  readonly commandId: string;
  /** true → 这是 "-cmd" 解绑标记, commandId 是去掉 "-" 之后的 id. */
  readonly unbind: boolean;
}

export function parseCommandId(raw: string): ParsedCommandId {
  if (raw.startsWith("-")) {
    return { unbind: true, commandId: raw.slice(1) };
  }
  return { unbind: false, commandId: raw };
}

const MOD_PREFIX = "Mod+";
const ALT_PREFIX = "Alt+";
const SHIFT_PREFIX = "Shift+";

export function parseChord(keys: string): KeyChord {
  let cmdOrCtrl = false;
  let alt = false;
  let shift = false;
  let rest = keys;
  let consumed = true;
  while (consumed) {
    consumed = false;
    if (rest.startsWith(MOD_PREFIX)) {
      if (cmdOrCtrl) {
        throw new Error(`Keybinding "${keys}" has duplicate "Mod"`);
      }
      cmdOrCtrl = true;
      rest = rest.slice(MOD_PREFIX.length);
      consumed = true;
    } else if (rest.startsWith(ALT_PREFIX)) {
      if (alt) {
        throw new Error(`Keybinding "${keys}" has duplicate "Alt"`);
      }
      alt = true;
      rest = rest.slice(ALT_PREFIX.length);
      consumed = true;
    } else if (rest.startsWith(SHIFT_PREFIX)) {
      if (shift) {
        throw new Error(`Keybinding "${keys}" has duplicate "Shift"`);
      }
      shift = true;
      rest = rest.slice(SHIFT_PREFIX.length);
      consumed = true;
    }
  }
  const code = rest.trim();
  if (!code) {
    throw new Error(`Keybinding "${keys}" has no key code`);
  }
  return { cmdOrCtrl, alt, shift, code };
}
