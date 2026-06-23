/**
 * 从 actionRegistry 把 surface 上的 actions 投影成 MenuTemplate.
 *
 * 分段算法 (VSCode 风格):
 *   1. 按 metadata.group 分组 (缺省 "9_other"), group 字典序排
 *   2. 不同 group 之间插 separator
 *   3. 同 group 内按 metadata.sortOrder 升序 (缺省 0), 同 sortOrder 按 title 字典序
 *
 * 快捷键 hint: 反查 keybindingRegistry.getBindingsFor(action.id), 取第一个 chord,
 * 用 toElectronAccelerator 转 Electron 格式 (仅显示, 不绑定; 实际触发在 web keymap 路径).
 */
import type { MenuItem, MenuTemplate } from "@shared/contracts/menu.ts";
import { actionRegistry } from "@/lib/actions/registry.ts";
import type { Action } from "@/lib/actions/types.ts";
import { keybindingRegistry } from "@/lib/keybindings/registry.ts";
import type { KeyChord } from "@/lib/keybindings/types.ts";

const DEFAULT_GROUP = "9_other";

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
  Period: ".",
  Quote: "'",
  Semicolon: ";",
  Slash: "/",
  Space: "Space",
  Tab: "Tab",
};

/**
 * KeyChord → Electron accelerator 字符串. KeyboardEvent.code 编码 → Electron 期待的
 * "CmdOrCtrl+Shift+K" / "Down" 风格. KeyN/KeyP 等去掉 Key 前缀; Digit1 → "1".
 */
export function toElectronAccelerator(chord: KeyChord): string {
  const parts: string[] = [];
  if (chord.cmdOrCtrl) {
    parts.push("CmdOrCtrl");
  }
  if (chord.alt) {
    parts.push("Alt");
  }
  if (chord.shift) {
    parts.push("Shift");
  }
  let key: string;
  if (chord.code.startsWith("Key")) {
    key = chord.code.slice(3);
  } else if (chord.code.startsWith("Digit")) {
    key = chord.code.slice(5);
  } else {
    key = CODE_TO_ELECTRON[chord.code] ?? chord.code;
  }
  parts.push(key);
  return parts.join("+");
}

function groupOf(a: Action): string {
  return a.metadata?.group ?? DEFAULT_GROUP;
}

function sortOrderOf(a: Action): number {
  return a.metadata?.sortOrder ?? 0;
}

function actionToMenuItem(a: Action): MenuItem {
  const binding = keybindingRegistry.getBindingsFor(a.id)[0];
  const accelerator = binding
    ? toElectronAccelerator(binding.chord)
    : undefined;
  const enabled = a.enabled?.() ?? true;
  return {
    type: "action",
    id: a.id,
    label: a.title(),
    enabled,
    ...(accelerator !== undefined && { accelerator }),
  };
}

/**
 * 把单个 group 桶投影成 MenuItem 序列.
 * 子菜单聚合: 同 submenu() key 合并; 没 submenu 字段平铺.
 * 子菜单位置 = 该 key 第一个 action 在桶里的相对位置.
 */
function buildBucketItems(bucket: readonly Action[]): MenuItem[] {
  type Placeholder =
    | { kind: "action"; a: Action }
    | { kind: "submenu"; key: string };
  const placeholders: Placeholder[] = [];
  const submenuMap = new Map<string, Action[]>();
  for (const a of bucket) {
    const key = a.metadata?.submenu?.();
    if (key) {
      let group = submenuMap.get(key);
      if (!group) {
        group = [];
        submenuMap.set(key, group);
        placeholders.push({ kind: "submenu", key });
      }
      group.push(a);
    } else {
      placeholders.push({ kind: "action", a });
    }
  }
  return placeholders.map((p) => {
    if (p.kind === "action") {
      return actionToMenuItem(p.a);
    }
    // submenuMap.get(p.key) 此时一定非空 (placeholder push 时已确保).
    const subActions = submenuMap.get(p.key) ?? [];
    return {
      type: "submenu",
      label: p.key,
      submenu: subActions.map(actionToMenuItem),
    };
  });
}

export function buildMenuEntries(surface: string): MenuTemplate {
  const actions = actionRegistry.list(surface);
  if (actions.length === 0) {
    return [];
  }

  // 按 group 收集
  const buckets = new Map<string, Action[]>();
  for (const a of actions) {
    const g = groupOf(a);
    const list = buckets.get(g) ?? [];
    list.push(a);
    buckets.set(g, list);
  }

  // group 字典序排
  const sortedGroups = Array.from(buckets.keys()).sort();

  const items: MenuItem[] = [];
  for (const [idx, g] of sortedGroups.entries()) {
    if (idx > 0) {
      items.push({ type: "separator" });
    }
    const bucket = buckets.get(g) ?? [];
    bucket.sort((a, b) => {
      const so = sortOrderOf(a) - sortOrderOf(b);
      if (so !== 0) {
        return so;
      }
      return a.title().localeCompare(b.title());
    });
    items.push(...buildBucketItems(bucket));
  }

  return items;
}
