import { TooltipProvider } from "@pier/ui/tooltip.tsx";
import type {
  RendererTerminalStatusItem,
  RendererTerminalStatusItemContext,
} from "@plugins/api/renderer.ts";
import type { PluginRegistryEntry } from "@shared/contracts/plugin.ts";
import { useMemo, useSyncExternalStore } from "react";
import { Notifier } from "@/lib/util/notifier.ts";
import { readVersionedSnapshot } from "@/lib/util/read-versioned-snapshot.ts";
import { usePluginRegistryStore } from "@/stores/plugin-registry.store.ts";
import { useTerminalStatusBarPrefsStore } from "@/stores/terminal-status-bar-prefs.store.ts";
import { CORE_TERMINAL_STATUS_ITEMS } from "./core-terminal-status-items.ts";
import { useTerminalStatusBarOverflow } from "./hooks/use-status-bar-overflow.ts";
import { openTerminalStatusBarContextMenu } from "./status-bar-menu.ts";
import {
  declaredTerminalStatusItemsById,
  mergeTerminalStatusItems,
  type TerminalStatusBarGroups,
} from "./status-bar-merge.ts";
import {
  pinnedIdsFromOverflowDeclarations,
  type TerminalStatusOverflowPolicy,
} from "./status-bar-overflow.ts";

export type TerminalStatusItemContext = RendererTerminalStatusItemContext;
export type TerminalStatusItem = RendererTerminalStatusItem;

/** Matches `h-7` on the status bar root — keep composer / floating insets in sync. */
export const TERMINAL_STATUS_BAR_HEIGHT_PX = 28;

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
const subscribeTerminalStatusItems = (listener: () => void): (() => void) =>
  terminalStatusItemRegistry.subscribe(listener);
const getTerminalStatusItemsVersion = (): number =>
  terminalStatusItemRegistry.getVersion();

export function useTerminalStatusItems(): readonly TerminalStatusItem[] {
  const version = useSyncExternalStore(
    subscribeTerminalStatusItems,
    getTerminalStatusItemsVersion,
    () => 0
  );
  return useMemo(
    () =>
      readVersionedSnapshot(version, () => terminalStatusItemRegistry.list()),
    [version]
  );
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
 * 声明源是否非空（设置页 / 右键菜单列表用）。
 * 挂载底栏请用 shouldMountTerminalStatusBar（只看可见项）。
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
 * 空闲策略：仅当有可见项时挂载底栏（高度 0 还给终端）。
 * 全部隐藏后的恢复入口：设置 → 终端 → 状态栏（不再靠空条右键）。
 * TerminalStatusBar 与 terminal-panel.tsx 的 hasStatusBar 必须共用本函数。
 */
export function shouldMountTerminalStatusBar(
  groups: TerminalStatusBarGroups<TerminalStatusItem>,
  context: TerminalStatusItemContext,
  _plugins: readonly PluginRegistryEntry[]
): boolean {
  return hasVisibleTerminalStatusItems(groups, context);
}

function overflowPolicyMapFromDeclared(
  plugins: readonly PluginRegistryEntry[]
): ReadonlyMap<string, TerminalStatusOverflowPolicy> {
  const declared = declaredTerminalStatusItemsById(
    plugins,
    CORE_TERMINAL_STATUS_ITEMS
  );
  const map = new Map<string, TerminalStatusOverflowPolicy>();
  for (const [id, item] of declared) {
    map.set(id, {
      overflowPinned: item.overflowPinned,
      overflowPriority: item.overflowPriority,
    });
  }
  return map;
}

function renderStatusGroup(
  items: readonly TerminalStatusItem[],
  statusContext: TerminalStatusItemContext,
  overflowHiddenIds: ReadonlySet<string>
) {
  return items.map((item) => (
    <div
      className="min-w-0 empty:hidden"
      data-overflow-slot={item.id}
      hidden={overflowHiddenIds.has(item.id)}
      key={item.id}
    >
      {item.render(statusContext)}
    </div>
  ));
}

export function TerminalStatusBar(statusContext: TerminalStatusItemContext) {
  const groups = useTerminalStatusBarItems();
  const plugins = usePluginRegistryStore((s) => s.plugins);
  const visible = visibleTerminalStatusItems(groups, statusContext);
  const shouldMount = shouldMountTerminalStatusBar(
    groups,
    statusContext,
    plugins
  );
  const overflowById = useMemo(
    () => overflowPolicyMapFromDeclared(plugins),
    [plugins]
  );
  const pinnedIds = useMemo(
    () => pinnedIdsFromOverflowDeclarations(overflowById),
    [overflowById]
  );
  const { hiddenIds, rootRef } = useTerminalStatusBarOverflow(shouldMount, {
    overflowById,
    pinnedIds,
  });
  // 仅有可见项时挂载；全部隐藏后从设置「终端 → 状态栏」恢复。
  if (!shouldMount) {
    return null;
  }
  return (
    // biome-ignore lint/a11y/noStaticElementInteractions lint/a11y/noNoninteractiveElementInteractions: 状态栏是原生右键菜单的触发面，无准确交互 ARIA role 可用
    <div
      className="absolute inset-x-0 bottom-0 z-0 flex h-7 items-center gap-1 overflow-hidden px-1.5 leading-none"
      data-testid="terminal-status-bar"
      onContextMenu={(event) => {
        openTerminalStatusBarContextMenu(event).catch((err: unknown) => {
          console.error("[terminal-status-bar] context menu failed:", err);
        });
      }}
      ref={rootRef}
    >
      <TooltipProvider>
        {renderStatusGroup(visible.left, statusContext, hiddenIds)}
        <div
          className="min-w-0 flex-1"
          data-testid="terminal-status-bar-spacer"
        />
        {renderStatusGroup(visible.right, statusContext, hiddenIds)}
      </TooltipProvider>
    </div>
  );
}
