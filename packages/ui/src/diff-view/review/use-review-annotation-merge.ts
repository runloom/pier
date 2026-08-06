/**
 * review annotation 合并 effect（F1.3，从 PierDiffView 主体抽离）。
 *
 * apply 层推 base（hunk-only）后，命令式 `updateItem` 合并 review
 * annotation。base re-parse 时 apply 重推 base（清 review），本 hook 依赖
 * `codeViewItems` 重跑重推合并，review annotation 不丢。两次 `updateItem`
 * 都在 layout 阶段同步，用户看不到中间态。
 *
 * `REVIEW_ANNOTATION_VERSION_OFFSET` 隔离 review 与 base 的 version 空间，
 * 避免 `@pierre/diffs` `syncItemRecord` 碰撞（同 version 拒更新）：base
 * version 是 re-parse 单调计数（每次 +1），review version 抬到 base 永远
 * 追不上的区间，base +1 不会撞 review version 导致 apply 推 base 被拒。
 *
 * `codeViewRef` 不进 deps（React 惯例：ref 对象终身稳定，effect 总能读
 * `ref.current` 最新值）。
 */
import type { CodeViewHandle, CodeViewItem } from "@pierre/diffs/react";
import { type RefObject, useLayoutEffect } from "react";
import {
  buildActiveReviewAnnotations,
  type PierActiveReviewSlot,
  REVIEW_ANNOTATION_VERSION_OFFSET,
} from "./annotation-anchors.ts";
import type { PierDiffAnnotationMetadata } from "./annotation-types.ts";

export function useDiffViewReviewAnnotationMerge({
  activeReviewEpoch,
  activeReviewSlotsByItem,
  codeViewItems,
  codeViewRef,
}: {
  readonly activeReviewEpoch?: number | undefined;
  readonly activeReviewSlotsByItem?:
    | ReadonlyMap<string, readonly PierActiveReviewSlot[]>
    | undefined;
  readonly codeViewItems: readonly CodeViewItem<PierDiffAnnotationMetadata>[];
  readonly codeViewRef: RefObject<CodeViewHandle<PierDiffAnnotationMetadata> | null>;
}): void {
  // biome-ignore lint/correctness/useExhaustiveDependencies: codeViewRef is a stable ref; effect reads ref.current at run time, ref object identity never changes
  useLayoutEffect(() => {
    const handle = codeViewRef.current;
    if (!handle) {
      return;
    }
    const epoch = activeReviewEpoch ?? 0;
    for (const baseItem of codeViewItems) {
      if (baseItem.type !== "diff") {
        continue;
      }
      const current = handle.getItem(baseItem.id);
      if (current === undefined) {
        continue;
      }
      const slots = activeReviewSlotsByItem?.get(baseItem.id);
      const reviewAnnotations = buildActiveReviewAnnotations(slots);
      // 有评论的行 base 侧已带 review-thread annotation（无折叠 badge 态）。
      // 草稿提交后会再挂一个乐观 thread 槽在同锚点，此处排除 base 侧同锚点的
      // review-thread，避免同一条评论渲染两张卡。
      const activeKeys =
        slots === undefined || slots.length === 0
          ? null
          : new Set(slots.map((slot) => `${slot.side}:${slot.lineNumber}`));
      const baseAnnotations = (baseItem.annotations ?? []).filter(
        (annotation) => {
          if (
            activeKeys !== null &&
            annotation.metadata?.kind === "review-thread" &&
            annotation.side !== undefined &&
            activeKeys.has(`${annotation.side}:${annotation.lineNumber}`)
          ) {
            return false;
          }
          return true;
        }
      );
      const mergedAnnotations =
        reviewAnnotations === undefined
          ? baseAnnotations
          : [...baseAnnotations, ...reviewAnnotations];
      const version =
        reviewAnnotations === undefined
          ? (baseItem.version ?? 0)
          : (baseItem.version ?? 0) + REVIEW_ANNOTATION_VERSION_OFFSET + epoch;
      if (current.version === version) {
        continue;
      }
      handle.updateItem({
        ...baseItem,
        annotations: mergedAnnotations,
        version,
      });
    }
  }, [codeViewItems, activeReviewSlotsByItem, activeReviewEpoch]);
}
