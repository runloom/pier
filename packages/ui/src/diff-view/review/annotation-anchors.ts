import type { DiffLineAnnotation, FileDiffMetadata } from "@pierre/diffs";
import type {
  PierDiffReviewCommentThread,
  PierDiffReviewDriftThread,
} from "../items.ts";
import type {
  PierDiffReviewAnnotationMetadata,
  PierReviewDraftAnnotationMetadata,
  PierReviewDriftAnnotationMetadata,
  PierReviewThreadAnnotationMetadata,
} from "./annotation-types.ts";

/**
 * review annotation version 与 base item version 之间的隔离偏移。
 *
 * `@pierre/diffs` 的 `syncItemRecord` 仅按 `version` 判等：同 version 拒绝
 * 更新（见 `CodeView.js` `syncItemRecord`）。base item version 是 re-parse
 * 单调计数（每次 +1，见 `items.ts` `toCodeViewItem`）；review annotation
 * 激活态也需独立 bump version 让 CodeView 重建行内槽位。两者共享同一数值
 * 空间会碰撞：base +1 追上 review version 时，apply 推 base 被
 * `syncItemRecord` 拒，新正文进不去。本偏移把 review version 抬到 base
 * 永远追不上的区间——一个 session 的 re-parse 次数远小于此值。
 */
export const REVIEW_ANNOTATION_VERSION_OFFSET = 1_000_000;

/**
 * 激活态评论槽（item 级视图态）。
 *
 * 由 git 插件 review hook（F3）按当前激活线程 / 草稿产出，经 `PierDiffView`
 * props（`activeReviewSlotsByItem`）注入；本模块把每个槽转成一条
 * `DiffLineAnnotation`，由 `PierDiffView` 合并 effect 命令式 `updateItem`
 * 推入对应 item.annotations，触发 `@pierre/diffs` 重建行内 `<slot>` →
 * `renderAnnotation` 行内渲染线程卡 / 草稿卡。
 *
 * - `draft`：新建线程草稿输入框（用户点 gutter `+` 入口后激活；取消则移除该槽）。
 * - `thread`：草稿提交成功后的乐观槽——立刻显示新评论，不等 comments 广播
 *   回流重建 base annotation。base 侧同锚点的 `review-thread` 由合并 effect
 *   去重排除，两者不会叠加。已有评论**不经**此槽渲染（无折叠态）。
 *
 * 激活态是视图级、不进 `toCodeViewItem` 的 content cacheKey；合并 effect
 * 对受影响 item bump version（`base.version + OFFSET + epoch`），让
 * `@pierre/diffs` `updateItem` 重建槽位 + remeasure（annotation 高度变化）。
 */
export type PierActiveReviewSlot =
  | {
      readonly draftId: string;
      readonly kind: "draft";
      readonly lineNumber: number;
      readonly side: "additions" | "deletions";
    }
  | {
      readonly kind: "thread";
      readonly lineNumber: number;
      readonly side: "additions" | "deletions";
      readonly threadId: string;
    };

/**
 * 把激活槽转成 diff-view review annotation。
 *
 * review 线程锚点 = slot 的 (side, lineNumber) 直接落点——无需 hunk 几何
 * 计算：线程已带 line/side，是用户在 gutter 上点出的具体行。每个 slot 一条
 * annotation；slot 顺序稳定性由 F3 hook 保证（useMemo 依赖）。
 */
export function buildActiveReviewAnnotations(
  slots: readonly PierActiveReviewSlot[] | undefined
): DiffLineAnnotation<PierDiffReviewAnnotationMetadata>[] | undefined {
  if (slots === undefined || slots.length === 0) {
    return;
  }
  const annotations: DiffLineAnnotation<PierDiffReviewAnnotationMetadata>[] =
    [];
  for (const slot of slots) {
    if (slot.kind === "draft") {
      const metadata: PierReviewDraftAnnotationMetadata = {
        draftId: slot.draftId,
        kind: "review-draft",
        lineNumber: slot.lineNumber,
        side: slot.side,
      };
      annotations.push({
        lineNumber: slot.lineNumber,
        metadata,
        side: slot.side,
      });
      continue;
    }
    const metadata: PierReviewThreadAnnotationMetadata = {
      kind: "review-thread",
      lineNumber: slot.lineNumber,
      side: slot.side,
      threadId: slot.threadId,
    };
    annotations.push({
      lineNumber: slot.lineNumber,
      metadata,
      side: slot.side,
    });
  }
  return annotations;
}

/**
 * 把文件级 drift 线程转成一条文件级 annotation（`lineNumber: 0`，首个 hunk 前
 * 渲染——`@pierre/diffs` 原生文件级 annotation）。
 *
 * 折叠区是文件级聚合：一个文件所有漂移 + 文件级线程收进同一条 annotation 的
 * `threads`，不按 thread 原 side 分裂。side 按 `fileDiff.type` 选：deleted
 * 文件走 deletions 侧（无 additions 侧可渲染），其他走 additions 侧。文件
 * 折叠时 `@pierre/diffs` 虚拟化门控不渲染文件级 annotation（`totalLines === 0`），
 * 对齐 GitHub outdated 折叠文件只显示 header——展开才在顶部见折叠区。
 */
export function buildDriftAnnotations(
  driftComments: readonly PierDiffReviewDriftThread[] | undefined,
  fileType: FileDiffMetadata["type"]
): DiffLineAnnotation<PierDiffReviewAnnotationMetadata>[] | undefined {
  if (driftComments === undefined || driftComments.length === 0) {
    return;
  }
  const side = fileType === "deleted" ? "deletions" : "additions";
  const metadata: PierReviewDriftAnnotationMetadata = {
    kind: "review-drift",
    threads: driftComments,
  };
  return [{ lineNumber: 0, metadata, side }];
}

/**
 * 把行内评论线程逐条转成 per-line `review-thread` annotation。
 *
 * **无折叠态**：有评论的行直接渲染 `InlineReviewThreadCard`，不再先塌成一个
 * 气泡 badge 等用户点开。v1 单条批注既无计数数字、也无 open/resolved 之分，
 * badge 与展开卡占用同一行 annotation 行高却只画一个通用图标——纯多一次点击。
 *
 * `reviewComments` 已是业务层判漂移后的行内匹配线程（漂移的进 `driftComments`
 * 走文件级折叠区）。与草稿提交后的乐观 thread 槽同锚点时由合并 effect 去重。
 */
export function buildInlineThreadAnnotations(
  reviewComments: readonly PierDiffReviewCommentThread[] | undefined
): DiffLineAnnotation<PierDiffReviewAnnotationMetadata>[] | undefined {
  if (reviewComments === undefined || reviewComments.length === 0) {
    return;
  }
  return reviewComments.map((thread) => {
    const metadata: PierReviewThreadAnnotationMetadata = {
      kind: "review-thread",
      lineNumber: thread.line,
      side: thread.side,
      threadId: thread.threadId,
    };
    return {
      lineNumber: thread.line,
      metadata,
      side: thread.side,
    };
  });
}
