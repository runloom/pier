/**
 * 从 actionRegistry 把 surface 上的 actions 投影成 MenuTemplate.
 *
 * 分段算法 (VSCode 风格):
 *   1. 按 metadata.group 分组 (缺省 "9_other"), group 字典序排
 *   2. 不同 group 之间插 separator
 *   3. 同 group 内按 metadata.sortOrder 升序 (缺省 0), 同 sortOrder 按 title 字典序
 *
 * 快捷键 hint: 优先反查 action 自身绑定, 没有时再借用 shortcutSourceId,
 * 用 toElectronAccelerator 转 Electron 格式 (仅显示, 不绑定; 实际触发在 web keymap 路径).
 */
import type { MenuItem, MenuTemplate } from "@shared/contracts/menu.ts";
import { actionRegistry } from "@/lib/actions/registry.ts";
import type { Action, ActionInvocation } from "@/lib/actions/types.ts";
import { keybindingRegistry } from "@/lib/keybindings/registry.ts";
import type { KeyChord } from "@/lib/keybindings/types.ts";
import {
  captureDomSelectionText,
  selectedTextFromInvocation,
} from "./selection-text.ts";

const DEFAULT_GROUP = "9_other";

/** 所有面板内容区共享的布局菜单 surface（拆分/聚焦/均分）。 */
export const PANEL_CONTENT_SURFACE = "panel/content";

const SURFACES_WITHOUT_SHARED_PANEL_CONTENT: Readonly<Record<string, true>> = {
  "command-palette": true,
  "create-menu": true,
  "dockview-tab": true,
  [PANEL_CONTENT_SURFACE]: true,
};

/**
 * 内容区菜单自动并入共享布局 actions；tab / 命令面板 / create-menu 不继承。
 * 这样 terminal/files/workbench 等本地 surface 不必各自声明均分/拆分/聚焦。
 */
export function expandContextMenuSurfaces(surface: string): readonly string[] {
  if (SURFACES_WITHOUT_SHARED_PANEL_CONTENT[surface]) {
    return [surface];
  }
  return [surface, PANEL_CONTENT_SURFACE];
}

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
  if (chord.ctrl) {
    // Electron accelerator 用 "Control" 字面表示独立 Ctrl (mac 上区分 Cmd/Ctrl).
    parts.push("Control");
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

function actionToMenuItem(a: Action, invocation?: ActionInvocation): MenuItem {
  const binding = keybindingRegistry.getFirstBindingFor(
    a.id,
    a.metadata?.shortcutSourceId
  );
  const accelerator = binding
    ? toElectronAccelerator(binding.chord)
    : undefined;
  const enabled = a.enabled?.(invocation) ?? true;
  // 复制选区：把弹菜单瞬间的文本钉到菜单项，main click 时直接写剪贴板。
  const clipboardText =
    a.id === "pier.panel.copySelection"
      ? selectedTextFromInvocation(invocation) || captureDomSelectionText()
      : "";
  return {
    type: "action",
    id: a.id,
    label: a.title(invocation),
    enabled,
    ...(accelerator !== undefined && { accelerator }),
    ...(clipboardText.length > 0 ? { clipboardText } : {}),
  };
}

/**
 * 把单个 group 桶投影成 MenuItem 序列.
 * 子菜单聚合: 同 submenu() key 合并; 没 submenu 字段平铺.
 * 子菜单位置 = 该 key 第一个 action 在桶里的相对位置.
 */
function buildBucketItems(
  bucket: readonly Action[],
  invocation?: ActionInvocation
): MenuItem[] {
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
      return actionToMenuItem(p.a, invocation);
    }
    // submenuMap.get(p.key) 此时一定非空 (placeholder push 时已确保).
    const subActions = submenuMap.get(p.key) ?? [];
    return {
      type: "submenu",
      label: p.key,
      submenu: subActions.map((action) => actionToMenuItem(action, invocation)),
    };
  });
}

export function buildMenuEntries(
  surface: string,
  invocation?: ActionInvocation
): MenuTemplate {
  // menuHidden = 整行移除 (如任务面板隐藏"新建终端"); enabled=false 仅置灰。
  const seen = new Set<string>();
  const actions: Action[] = [];
  for (const candidate of expandContextMenuSurfaces(surface)) {
    for (const action of actionRegistry.list(candidate)) {
      if (seen.has(action.id)) {
        continue;
      }
      seen.add(action.id);
      if (action.metadata?.menuHidden?.(invocation) === true) {
        continue;
      }
      actions.push(action);
    }
  }
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
      return a.title(invocation).localeCompare(b.title(invocation));
    });
    items.push(...buildBucketItems(bucket, invocation));
  }

  return items;
}
