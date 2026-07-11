import type {
  RendererTerminalStatusItem,
  RendererTerminalStatusItemContext,
} from "@plugins/api/renderer.ts";
import type { PluginRegistryEntry } from "@shared/contracts/plugin.ts";
import { useMemo, useSyncExternalStore } from "react";
import { Notifier } from "@/lib/util/notifier.ts";
import { usePluginRegistryStore } from "@/stores/plugin-registry.store.ts";
import { useTerminalStatusBarPrefsStore } from "@/stores/terminal-status-bar-prefs.store.ts";
import { CORE_TERMINAL_STATUS_ITEMS } from "./core-terminal-status-items.ts";
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
    if (this.items.has(item.id)) {
      throw new Error(
        `terminal status item id is already registered: ${item.id}`
      );
    }
    this.items.set(item.id, item);
    this.notify();
    return () => {
      if (this.items.get(item.id) === item) {
        this.items.delete(item.id);
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
        declaredTerminalStatusItemsById(plugins, CORE_TERMINAL_STATUS_ITEMS),
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

/**
 * F4:挂载判定口径 —— 只要有已启用插件在 manifest 里声明了 terminalStatusItems
 * (无论该项当前 hidden 生效值如何),状态栏容器就应该挂载,以保留 h-7 高度和
 * 右键管理入口。此前用 hasVisibleTerminalStatusItems(合并层已在内部把 hidden
 * 项过滤掉)判定挂载,会导致「全部隐藏后容器 unmount → 找不到入口重新打开」的
 * 自锁:用户想恢复显示,却连右键菜单都没有了。
 *
 * 与 terminal-panel.tsx 的 hasStatusBar 判定必须同一口径 —— 两处都改这个函数,
 * 不要各自维出一份等价逻辑。
 *
 * 注:core 声明源(CORE_TERMINAL_STATUS_ITEMS)恒非空,本函数实际恒返回 true ——
 * 设计原意为「有声明就挂载」故不视为退化;详见 spec §5。
 */
export function hasDeclaredTerminalStatusItems(
  plugins: readonly PluginRegistryEntry[]
): boolean {
  return (
    declaredTerminalStatusItemsById(plugins, CORE_TERMINAL_STATUS_ITEMS).size >
    0
  );
}

/**
 * F4:挂载判定的唯一实现 —— TerminalStatusBar 组件与 terminal-panel.tsx 的
 * hasStatusBar(控制 h-7 内容区留白)都必须调这一个函数,禁止各自重复等价逻辑
 * (曾经两处判定口径不一致是本 bug 的根因之一)。
 *
 * 注:core 声明源(CORE_TERMINAL_STATUS_ITEMS)恒非空,hasDeclaredTerminalStatusItems
 * 恒返回 true,故本函数也恒返回 true —— 设计原意为「有声明就挂载」故不视为退化;
 * 详见 spec §5。
 */
export function shouldMountTerminalStatusBar(
  groups: TerminalStatusBarGroups<TerminalStatusItem>,
  context: TerminalStatusItemContext,
  plugins: readonly PluginRegistryEntry[]
): boolean {
  return (
    hasDeclaredTerminalStatusItems(plugins) ||
    hasVisibleTerminalStatusItems(groups, context)
  );
}

function renderStatusGroup(
  items: readonly TerminalStatusItem[],
  statusContext: TerminalStatusItemContext
) {
  return items.map((item) => (
    <div className="min-w-0" key={item.id}>
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
  const plugins = usePluginRegistryStore((s) => s.plugins);
  const statusContext = { context, cwd, panelId, title };
  const visible = visibleTerminalStatusItems(groups, statusContext);
  // F4:挂载判定见 shouldMountTerminalStatusBar 注释 —— 此前只看「当前有可见
  // 项」,用户把全部项都隐藏后容器连同右键管理入口一起 unmount,没有任何 UI
  // 能再打开恢复,构成自锁。
  // 注:core 声明源恒非空,shouldMountTerminalStatusBar 实际恒返回 true —— 设计
  // 原意为「有声明就挂载」故不视为退化;详见 spec §5。
  if (!shouldMountTerminalStatusBar(groups, statusContext, plugins)) {
    return null;
  }
  return (
    // biome-ignore lint/a11y/noStaticElementInteractions lint/a11y/noNoninteractiveElementInteractions: 状态栏是原生右键菜单的触发面，无准确交互 ARIA role 可用
    <div
      className="absolute inset-x-0 bottom-0 flex h-7 items-center gap-1 px-1.5 leading-none"
      data-testid="terminal-status-bar"
      onContextMenu={(event) => {
        openTerminalStatusBarContextMenu(event).catch((err: unknown) => {
          console.error("[terminal-status-bar] context menu failed:", err);
        });
      }}
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
