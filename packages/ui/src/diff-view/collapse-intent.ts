/**
 * 视图级折叠缺省（工具栏「折叠 / 展开全部文件」）。
 *
 * 折叠态有两层：
 * - per-item 显式意图（`collapsedItemsRef`）：用户点单个文件 chevron / header
 * - 视图级缺省（本模块）：作用于**尚未持有显式意图**的槽位
 *
 * 缺省层是必需的：CodeView 显示集 = 全部 content 槽（estimate|loaded|…）；
 * 正文水合与成员进出都可发生在点击「折叠全部」之后。若只逐项补写显式意图，
 * 后来才进表/才水合的文件会回落解析默认（有正文即展开），表现为「折叠全部漏折叠」。
 * demand 只调度 document 读，不决定有无 id。
 */
import { type RefObject, useCallback } from "react";
import type { DiffViewCollapsedItemState } from "./handle-types.ts";
import type { PierDiffCodeViewItem } from "./items.ts";

/** true = 全部折叠，false = 全部展开，null = 无视图级意图（用解析默认）。 */
export type DiffViewCollapseAllIntent = boolean | null;

/**
 * 0 正文行槽（estimate / error / ready-notice / 纯 mode 变更）。
 * 展开它们只会得到空壳，且 estimate 禁止展开成假行号文件体（见 items.ts）。
 */
export function codeViewItemHasEmptyBody(item: PierDiffCodeViewItem): boolean {
  if (item.type !== "diff") {
    return false;
  }
  return (
    item.fileDiff.splitLineCount === 0 && item.fileDiff.unifiedLineCount === 0
  );
}

/**
 * 单槽折叠态：显式 per-item 意图 > 视图级缺省 > 解析默认（undefined）。
 *
 * 缺省层的 revision 恒为 0：内容版本已由解析结果决定，缺省不构成一次折叠翻转，
 * 不能再顶高 version（会与「内容版本 + 折叠修订」公式撞号）。
 */
export function resolveCollapsedItemState(
  item: PierDiffCodeViewItem,
  explicit: DiffViewCollapsedItemState | undefined,
  intent: DiffViewCollapseAllIntent
): DiffViewCollapsedItemState | undefined {
  if (explicit) {
    return explicit;
  }
  if (intent === null) {
    return;
  }
  if (!intent && codeViewItemHasEmptyBody(item)) {
    return;
  }
  return { collapsed: intent, revision: 0 };
}

/** 折叠态落到 item 上；无变化时返回原对象（保持引用相等，避免多余 setItems）。 */
export function applyCollapsedItemState(
  item: PierDiffCodeViewItem,
  state: DiffViewCollapsedItemState | undefined
): PierDiffCodeViewItem {
  if (!state) {
    return item;
  }
  if (state.revision === 0 && item.collapsed === state.collapsed) {
    return item;
  }
  return {
    ...item,
    collapsed: state.collapsed,
    version:
      (typeof item.version === "number" ? item.version : 0) + state.revision,
  };
}

/**
 * 用户是否主动收起了该槽位。
 *
 * 与 `item.collapsed` 不是一回事：estimate / notice 的 collapsed 是「没有正文可展开」
 * 的技术默认，不表示用户想收起。骨架屏这类「正文马上就来」的提示只能被**用户意图**
 * 抑制，不能被技术默认抑制（否则骨架永远不显示）。
 */
export function isUserCollapsedItem(
  id: string,
  collapsedItems: ReadonlyMap<string, DiffViewCollapsedItemState>,
  intent: DiffViewCollapseAllIntent
): boolean {
  return collapsedItems.get(id)?.collapsed ?? intent === true;
}

/** 读最新 ref 的稳定谓词：渲染热路径（onPostRender）用，不能进 deps 抖动。 */
export function useUserCollapsedPredicate(
  collapsedItemsRef: RefObject<Map<string, DiffViewCollapsedItemState>>,
  collapseAllIntentRef: RefObject<DiffViewCollapseAllIntent>
): (itemId: string) => boolean {
  return useCallback(
    (itemId: string) =>
      isUserCollapsedItem(
        itemId,
        collapsedItemsRef.current,
        collapseAllIntentRef.current
      ),
    [collapsedItemsRef, collapseAllIntentRef]
  );
}

/** 整份解析结果套用折叠层（membership / inputs 变更路径）。 */
export function applyCollapseIntentToItems(
  items: readonly PierDiffCodeViewItem[],
  collapsedItems: ReadonlyMap<string, DiffViewCollapsedItemState>,
  intent: DiffViewCollapseAllIntent
): PierDiffCodeViewItem[] {
  return items.map((item) =>
    applyCollapsedItemState(
      item,
      resolveCollapsedItemState(item, collapsedItems.get(item.id), intent)
    )
  );
}

/**
 * 「折叠 / 展开全部」要逐项翻转的 id。
 * 展开时跳过空正文槽：它们没有可展开的正文，翻开只是空壳。
 */
export function collapseAllTargetIds(
  items: readonly PierDiffCodeViewItem[],
  collapsed: boolean
): string[] {
  const ids: string[] = [];
  for (const item of items) {
    if (!(collapsed || !codeViewItemHasEmptyBody(item))) {
      continue;
    }
    ids.push(item.id);
  }
  return ids;
}
