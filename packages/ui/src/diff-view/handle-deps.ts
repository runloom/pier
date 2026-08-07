/**
 * `PierDiffViewHandle` 实现所需的可变引用集合。
 * 独立模块：handle 的各能力（滚动 / 选区 / 正文更新）共享同一份依赖，
 * 放在 use-handle 里会造成 handle 子模块回指形成环。
 */
import type { CodeViewHandle } from "@pierre/diffs/react";
import type { RefObject } from "react";
import type { DiffViewCollapseAllIntent } from "./collapse-intent.ts";
import type { DiffMetrics } from "./geometry.ts";
import type {
  DiffViewCollapsedItemState,
  DiffViewRenderItemIdentity,
} from "./handle-types.ts";
import type { ParsedItemCacheEntry, PierDiffCodeViewItem } from "./items.ts";
import type { PierDiffAnnotationMetadata } from "./review/annotation-types.ts";

export interface DiffViewHandleDeps {
  readonly appliedItemsRef: RefObject<{
    readonly key: string;
    readonly items: Map<string, PierDiffCodeViewItem>;
  } | null>;
  readonly auditVisibleItems: () => void;
  readonly bumpItemEpoch: () => void;
  readonly codeViewRef: RefObject<CodeViewHandle<PierDiffAnnotationMetadata> | null>;
  readonly collapseAllIntentRef: RefObject<DiffViewCollapseAllIntent>;
  readonly collapsedItemsRef: RefObject<
    Map<string, DiffViewCollapsedItemState>
  >;
  readonly expectItemRender: (id: string, version: number | undefined) => void;
  readonly firstLayoutItemIdsRef: RefObject<Set<string>>;
  /** 用户折叠意图（estimate 骨架高度校正用，≠ item.collapsed 技术默认）。 */
  readonly isUserCollapsed: (itemId: string) => boolean;
  readonly itemErrorIdsRef: RefObject<Set<string>>;
  /** 唯一几何 metrics（geometry.diffMetrics）。 */
  readonly metrics: DiffMetrics;
  readonly onItemErrorRef: RefObject<
    ((id: string, error: Error | null) => void) | undefined
  >;
  readonly parsedItemIndexesRef: RefObject<Map<string, number>>;
  readonly parsedItemListRef: RefObject<PierDiffCodeViewItem[]>;
  readonly parsedItemsRef: RefObject<Map<string, ParsedItemCacheEntry>>;
  readonly renderItemIdentitiesRef: RefObject<
    Map<string, DiffViewRenderItemIdentity>
  >;
  readonly scheduleRenderWindowReport: () => void;
  /**
   * 选区文本粘性快照：右键 pointerdown 时钉住浏览器/行选文本。
   * getSelectedText 在 live 选区塌掉后仍可读此字段（菜单复制主路径）。
   */
  readonly selectedTextRef: RefObject<string>;
  readonly setItemCollapsed: (
    id: string,
    collapsed: boolean,
    preserveTopAnchor?: boolean,
    /** collapse-all 批量路径传 false：只改标志，最后一次 reconcile。 */
    reconcileHeights?: boolean
  ) => boolean;
}
