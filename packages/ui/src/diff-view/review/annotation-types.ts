/**
 * diff-view annotation metadata 联合 + 行内评论 annotation 类型。
 *
 * `PierHunkAnnotationMetadata`（hunk Stage/Unstage/Revert pill）仍是 hunk 域，
 * 保留在 `../hunk-actions.tsx`；本文件补齐评论域两种 annotation metadata，并
 * 组成 `PierDiffAnnotationMetadata` 联合作为整个 diff-view CodeView 的泛型锚点
 *（`CodeViewItem<T>` / `CodeViewOptions<T>` 的 T）。
 *
 * - `review-thread`：已有线程的行内展开态（用户点 gutter 计数入口后注入）。
 * - `review-draft`：新建线程的行内草稿态（用户点 gutter `+` 入口后注入临时
 *   输入框；提交成功转真实 thread，取消则移除）。
 *
 * 激活态由数据驱动（注入/移除 annotation），不靠独立浮层 state——对齐
 * GitHub / loomdesk 行内锚定，滚出滚入由 @pierre/diffs SlotPortals 自动管理。
 */

import type { PierHunkAnnotationMetadata } from "../hunk-actions.tsx";
import type { PierImageDiffAnnotationMetadata } from "../image-diff/annotation.ts";
import type { PierDiffReviewDriftThread } from "../items.ts";

/** 行内评论线程 annotation metadata（激活态：已有线程行内展开）。 */
export interface PierReviewThreadAnnotationMetadata {
  readonly kind: "review-thread";
  readonly lineNumber: number;
  readonly side: "additions" | "deletions";
  readonly threadId: string;
}

/** 行内评论草稿 annotation metadata（新建态：临时输入框）。 */
export interface PierReviewDraftAnnotationMetadata {
  readonly draftId: string;
  readonly kind: "review-draft";
  readonly lineNumber: number;
  readonly side: "additions" | "deletions";
}

/**
 * 文件级漂移评论 annotation metadata（文件 header 下折叠区，对齐 GitHub
 * outdated）。由 `toCodeViewItem` 从 `input.driftComments` 构建一条
 * `lineNumber: 0` 文件级 annotation（首个 hunk 前渲染）；`renderAnnotation`
 * 分派到 `DriftedComments` 折叠区——summary 行（「代码已修改」+ 原行号）+
 * 展开态复用 `InlineReviewThreadCard`（完整 thread 经 `threadById` 查，与
 * `review-thread` 同构）。
 *
 * `lineNumber: 0` 文件级 annotation 受 `@pierre/diffs` 虚拟化门控：文件折叠
 * 时不渲染（对齐 GitHub outdated 折叠文件只显示 header），展开时在顶部渲染。
 */
export interface PierReviewDriftAnnotationMetadata {
  readonly kind: "review-drift";
  /** 该文件的漂移 + 文件级线程（折叠区 summary + 展开态数据源）。 */
  readonly threads: readonly PierDiffReviewDriftThread[];
}

/**
 * diff-view annotation metadata 联合。作为 CodeView 泛型锚点，使 annotation
 * 通道同时承载 hunk pill 与行内评论线程/草稿/漂移折叠区。
 */
export type PierDiffAnnotationMetadata =
  | PierHunkAnnotationMetadata
  | PierDiffReviewAnnotationMetadata
  | PierImageDiffAnnotationMetadata;

/** 评论域 annotation metadata（线程卡 + 草稿 + 漂移折叠区）。 */
export type PierDiffReviewAnnotationMetadata =
  | PierReviewDraftAnnotationMetadata
  | PierReviewDriftAnnotationMetadata
  | PierReviewThreadAnnotationMetadata;

export function isReviewDraftAnnotation(
  value: unknown
): value is PierReviewDraftAnnotationMetadata {
  if (value === null || typeof value !== "object") {
    return false;
  }
  const record = value as Record<string, unknown>;
  return (
    record.kind === "review-draft" &&
    typeof record.draftId === "string" &&
    (record.side === "additions" || record.side === "deletions") &&
    typeof record.lineNumber === "number"
  );
}

export function isReviewThreadAnnotation(
  value: unknown
): value is PierReviewThreadAnnotationMetadata {
  if (value === null || typeof value !== "object") {
    return false;
  }
  const record = value as Record<string, unknown>;
  return (
    record.kind === "review-thread" &&
    typeof record.threadId === "string" &&
    (record.side === "additions" || record.side === "deletions") &&
    typeof record.lineNumber === "number"
  );
}

export function isReviewDriftAnnotation(
  value: unknown
): value is PierReviewDriftAnnotationMetadata {
  if (value === null || typeof value !== "object") {
    return false;
  }
  const record = value as Record<string, unknown>;
  return record.kind === "review-drift" && Array.isArray(record.threads);
}
