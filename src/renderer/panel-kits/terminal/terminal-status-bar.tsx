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
  // onContextMenu div 有 role — role="menubar" 是 biome 可接受的交互 role 中
  // 语义最贴近的(横向状态项容器, 右键唤起菜单, 类比系统菜单栏).
  return (
    <div
      className="absolute inset-x-0 bottom-0 flex h-7 items-center gap-1 px-1.5 leading-none"
      data-testid="terminal-status-bar"
      onContextMenu={(event) => {
        openTerminalStatusBarContextMenu(event).catch((err: unknown) => {
          console.error("[terminal-status-bar] context menu failed:", err);
        });
      }}
      role="menubar"
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
