/**
 * 终端状态栏生效值合并纯函数 — 不触 registry 单例、不触 store,Vitest 单测主体。
 *
 * 语义(设计文档 §3.3,与 shared/contracts/plugin.ts 注释一致,勿改):
 * - 生效值 = 用户覆盖 ?? manifest 声明 ?? 默认(alignment "left"、order 0、可见)。
 * - hidden 只有用户覆盖来源,默认 false;hidden 项在此层被过滤
 *   (isVisible 动态可见性在其后、组件层执行)。
 * - 同侧内 order 越小越靠外侧:left 组 order 小 → 靠左;right 组 order 小 → 靠右。
 *   同 order 按 id 字典序,字典序小者更靠外侧。
 * - 返回的 left/right 数组都是 DOM 渲染序(从左到右):left = 外侧优先升序原样;
 *   right = 外侧优先升序再 reverse(order 最小项落在 DOM 最右 = 右组最外侧)。
 */
import type {
  PluginRegistryEntry,
  PluginTerminalStatusItemContribution,
} from "@shared/contracts/plugin.ts";
import type {
  TerminalStatusBarItemOverride,
  TerminalStatusBarPrefs,
} from "@shared/contracts/terminal-status-bar.ts";

export type DeclaredTerminalStatusItem = Pick<
  PluginTerminalStatusItemContribution,
  "alignment" | "order"
>;

export interface EffectiveTerminalStatusItemConfig {
  alignment: "left" | "right";
  hidden: boolean;
  order: number;
}

export interface TerminalStatusBarGroups<T> {
  left: T[];
  right: T[];
}

export function resolveEffectiveTerminalStatusItemConfig(
  declared: DeclaredTerminalStatusItem | undefined,
  override: TerminalStatusBarItemOverride | undefined
): EffectiveTerminalStatusItemConfig {
  return {
    alignment: override?.alignment ?? declared?.alignment ?? "left",
    hidden: override?.hidden ?? false,
    order: override?.order ?? declared?.order ?? 0,
  };
}

/** 外侧优先比较:order 升序,同 order 按 id 字典序。 */
export function compareOuterFirst(
  a: { readonly id: string; readonly order: number },
  b: { readonly id: string; readonly order: number }
): number {
  return a.order - b.order || a.id.localeCompare(b.id);
}

/** 已启用插件 manifest 声明的状态栏项索引(设置页与合并管道共用数据源)。 */
export function declaredTerminalStatusItemsById(
  plugins: readonly PluginRegistryEntry[]
): ReadonlyMap<string, PluginTerminalStatusItemContribution> {
  const byId = new Map<string, PluginTerminalStatusItemContribution>();
  for (const entry of plugins) {
    if (!entry.enabled) {
      continue;
    }
    for (const item of entry.manifest.terminalStatusItems) {
      byId.set(item.id, item);
    }
  }
  return byId;
}

export function mergeTerminalStatusItems<T extends { readonly id: string }>(
  registered: readonly T[],
  declaredById: ReadonlyMap<string, DeclaredTerminalStatusItem>,
  prefs: TerminalStatusBarPrefs
): TerminalStatusBarGroups<T> {
  const left: Array<{ id: string; item: T; order: number }> = [];
  const right: Array<{ id: string; item: T; order: number }> = [];
  for (const item of registered) {
    const config = resolveEffectiveTerminalStatusItemConfig(
      declaredById.get(item.id),
      prefs.items[item.id]
    );
    if (config.hidden) {
      continue;
    }
    const sortable = { id: item.id, item, order: config.order };
    if (config.alignment === "right") {
      right.push(sortable);
    } else {
      left.push(sortable);
    }
  }
  left.sort(compareOuterFirst);
  right.sort(compareOuterFirst);
  right.reverse();
  return {
    left: left.map((entry) => entry.item),
    right: right.map((entry) => entry.item),
  };
}

/**
 * 设置页组内重排后的归一化 order:按外侧优先的目标顺序给 index*10。
 * 留 10 的间隙,让 manifest 后续新增项(常见 order 0/10/20)能插空。
 */
export function normalizedGroupOrders(
  outerFirstIds: readonly string[]
): Record<string, number> {
  const orders: Record<string, number> = {};
  outerFirstIds.forEach((id, index) => {
    orders[id] = index * 10;
  });
  return orders;
}
