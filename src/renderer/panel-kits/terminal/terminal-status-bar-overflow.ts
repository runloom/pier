/**
 * 终端状态栏金标准溢出：按真实占用测宽，整项隐藏（不裁半个按钮）。
 * 截断由可见项自身 CSS（min-w-0 + truncate）完成，不是独立产品态。
 */

export interface TerminalStatusOverflowSlot {
  id: string;
  /** 越大越先被隐藏。 */
  priority: number;
  /** 自然宽（flex-shrink:0 时测得）；0 表示当前无内容，不参与争宽。 */
  width: number;
}

export interface FitTerminalStatusOverflowInput {
  availableWidth: number;
  /** 项间距（与底栏 gap 一致）。 */
  gap: number;
  /**
   * 中间 spacer 是否始终占一个 flex 子项（TerminalStatusBar 为 true）。
   * 此时可见槽位数为 n 时，gap 次数为 n（而非 n-1）。
   */
  hasFlexSpacer?: boolean;
  /**
   * 永不因溢出隐藏的 id（通常是分支身份）。
   * 若仍放不下，交给 CSS 截断 + 容器 overflow:hidden。
   * 空内容（width=0）仍会隐藏，避免空壳占 gap。
   */
  pinnedIds?: ReadonlySet<string>;
  slots: readonly TerminalStatusOverflowSlot[];
}

/** 未在贡献声明里写 overflowPriority 时的默认值（介于 sync 与 changes 之间）。 */
export const DEFAULT_TERMINAL_STATUS_OVERFLOW_PRIORITY = 25;

/**
 * 返回应整项 hidden 的 id 列表（稳定排序）。
 * - width===0 的空槽一律隐藏（含 pinned），避免空壳仍吃 flex gap；
 * - width>0 再按 priority 藏到放得下；pinned 跳过溢出隐藏。
 */
export function fitTerminalStatusOverflow(
  input: FitTerminalStatusOverflowInput
): string[] {
  const pinned = input.pinnedIds ?? new Set<string>();
  const emptyHidden = input.slots
    .filter((slot) => slot.width <= 0 && slot.id.length > 0)
    .map((slot) => slot.id);
  const active = input.slots.filter((slot) => slot.width > 0);
  if (active.length === 0) {
    return [...new Set(emptyHidden)].sort((a, b) => a.localeCompare(b));
  }

  const hidden = new Set<string>(emptyHidden);
  const gap = Math.max(0, input.gap);
  const hasSpacer = input.hasFlexSpacer ?? false;

  const sumVisible = (): number => {
    const visible = active.filter((slot) => !hidden.has(slot.id));
    if (visible.length === 0) {
      return 0;
    }
    const gapCount = hasSpacer
      ? visible.length
      : Math.max(0, visible.length - 1);
    return (
      visible.reduce((total, slot) => total + slot.width, 0) + gap * gapCount
    );
  };

  const hideOrder = [...active]
    .filter((slot) => !pinned.has(slot.id))
    .sort((a, b) => b.priority - a.priority || a.id.localeCompare(b.id));

  for (const slot of hideOrder) {
    if (sumVisible() <= input.availableWidth) {
      break;
    }
    hidden.add(slot.id);
  }

  return [...hidden].sort((a, b) => a.localeCompare(b));
}

export interface TerminalStatusOverflowPolicy {
  overflowPinned?: boolean | undefined;
  overflowPriority?: number | undefined;
}

/**
 * 从贡献声明解析溢出策略；未声明时 priority 默认 25、pinned false。
 */
export function resolveTerminalStatusOverflowPolicy(
  id: string,
  declared: ReadonlyMap<string, TerminalStatusOverflowPolicy> | undefined
): { pinned: boolean; priority: number } {
  const entry = declared?.get(id);
  return {
    pinned: entry?.overflowPinned ?? false,
    priority:
      entry?.overflowPriority ?? DEFAULT_TERMINAL_STATUS_OVERFLOW_PRIORITY,
  };
}

export function overflowPriorityForStatusItem(
  id: string,
  declared?: ReadonlyMap<string, TerminalStatusOverflowPolicy>
): number {
  return resolveTerminalStatusOverflowPolicy(id, declared).priority;
}

export function pinnedIdsFromOverflowDeclarations(
  declared: ReadonlyMap<string, TerminalStatusOverflowPolicy>
): ReadonlySet<string> {
  const pinned = new Set<string>();
  for (const [id, policy] of declared) {
    if (policy.overflowPinned) {
      pinned.add(id);
    }
  }
  return pinned;
}
