/**
 * DSL 解析: "Mod+Shift+KeyP" / "Ctrl+Shift+ArrowUp" → KeyChord.
 *
 * 修饰符 token 接受: Mod / Ctrl / Alt / Shift.
 * - Mod: 平台主修饰键 (mac=Cmd, 非 mac=Ctrl). cmdOrCtrl=true, ctrl=false.
 * - Ctrl:
 *   - mac 上 → 独立 Ctrl 物理键 (cmdOrCtrl=false, ctrl=true).
 *   - 非 mac 上 → 等价 Mod (cmdOrCtrl=true, ctrl=false), 因为非 mac 上
 *     Ctrl 就是 Mod 物理键, 不区分.
 *
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
const CTRL_PREFIX = "Ctrl+";
const ALT_PREFIX = "Alt+";
const SHIFT_PREFIX = "Shift+";

interface ModState {
  alt: boolean;
  cmdOrCtrl: boolean;
  ctrl: boolean;
  shift: boolean;
}

/**
 * 单个 modifier handler — 检测重复 + 应用副作用. 返回 true 表示成功消费,
 * 调用方需 slice 掉前缀.
 */
type ModHandler = (state: ModState, isMac: boolean, keys: string) => void;

const MOD_HANDLERS: readonly { prefix: string; apply: ModHandler }[] = [
  {
    prefix: MOD_PREFIX,
    apply: (state, _isMac, keys) => {
      if (state.cmdOrCtrl) {
        throw new Error(`Keybinding "${keys}" has duplicate "Mod"`);
      }
      state.cmdOrCtrl = true;
    },
  },
  {
    prefix: CTRL_PREFIX,
    apply: (state, isMac, keys) => {
      if (state.ctrl || (state.cmdOrCtrl && !isMac)) {
        throw new Error(`Keybinding "${keys}" has duplicate "Ctrl"/"Mod"`);
      }
      if (isMac) {
        state.ctrl = true;
      } else {
        state.cmdOrCtrl = true;
      }
    },
  },
  {
    prefix: ALT_PREFIX,
    apply: (state, _isMac, keys) => {
      if (state.alt) {
        throw new Error(`Keybinding "${keys}" has duplicate "Alt"`);
      }
      state.alt = true;
    },
  },
  {
    prefix: SHIFT_PREFIX,
    apply: (state, _isMac, keys) => {
      if (state.shift) {
        throw new Error(`Keybinding "${keys}" has duplicate "Shift"`);
      }
      state.shift = true;
    },
  },
];

/**
 * 尝试消费 rest 开头的一个 modifier. 命中: 返回 slice 后的 rest; 否则: 返回 null.
 */
function consumeModifier(
  rest: string,
  state: ModState,
  isMac: boolean,
  keys: string
): string | null {
  for (const { prefix, apply } of MOD_HANDLERS) {
    if (rest.startsWith(prefix)) {
      apply(state, isMac, keys);
      return rest.slice(prefix.length);
    }
  }
  return null;
}

export function parseChord(keys: string, isMac = false): KeyChord {
  const state: ModState = {
    cmdOrCtrl: false,
    ctrl: false,
    alt: false,
    shift: false,
  };
  let rest = keys;
  while (true) {
    const next = consumeModifier(rest, state, isMac, keys);
    if (next === null) {
      break;
    }
    rest = next;
  }
  const code = rest.trim();
  if (!code) {
    throw new Error(`Keybinding "${keys}" has no key code`);
  }
  return {
    cmdOrCtrl: state.cmdOrCtrl,
    ctrl: state.ctrl,
    alt: state.alt,
    shift: state.shift,
    code,
  };
}
