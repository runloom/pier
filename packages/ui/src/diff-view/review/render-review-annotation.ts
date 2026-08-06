/**
 * review annotation 分派渲染（F2，从 useDiffViewCodeOptions 抽离）。
 *
 * 把 `review-thread` / `review-draft` annotation metadata 分派到对应行内卡
 * （`InlineReviewThreadCard` / `InlineReviewDraftCard`）。非 review
 * annotation 返回 `undefined`（调用方继续 hunk-actions 逻辑）；是 review
 * 但缺数据（handlers/labels/locale/threadById 未提供）返回 `null`（不渲染）。
 *
 * 数据 + 回调 + labels 经 `options` 注入，不耦合 host 评论契约——对齐
 * diff-view 通用槽边界。options 解构到局部变量以稳定 narrowing（对象属性
 * narrowing 在 `threadById.get()` 等方法调用后会丢失）。
 */
import { createElement, type ReactNode } from "react";
import type { PierDriftCommentLabels } from "../gutter/gutter-comments.tsx";
import {
  isReviewDraftAnnotation,
  isReviewDriftAnnotation,
  isReviewThreadAnnotation,
} from "./annotation-types.ts";
import { DriftedComments } from "./drifted-comments.tsx";
import type {
  PierInlineReviewHandlers,
  PierInlineReviewLabels,
  PierInlineReviewThread,
} from "./inline-comment-types.ts";
import { InlineReviewDraftCard } from "./inline-draft-card.tsx";
import { InlineReviewThreadCard } from "./inline-thread-card.tsx";

export function renderReviewAnnotation(
  metadata: unknown,
  options: {
    readonly driftCommentLabels?: PierDriftCommentLabels | undefined;
    readonly handlers?: PierInlineReviewHandlers | undefined;
    readonly labels?: PierInlineReviewLabels | undefined;
    readonly locale?: string | undefined;
    readonly threadById?:
      | ReadonlyMap<string, PierInlineReviewThread>
      | undefined;
  }
): ReactNode | undefined {
  const { driftCommentLabels, handlers, labels, locale, threadById } = options;
  if (isReviewThreadAnnotation(metadata)) {
    if (
      handlers === undefined ||
      labels === undefined ||
      threadById === undefined ||
      locale === undefined
    ) {
      return null;
    }
    const thread = threadById.get(metadata.threadId);
    if (thread === undefined) {
      return null;
    }
    return createElement(InlineReviewThreadCard, {
      handlers,
      labels,
      thread,
    });
  }
  if (isReviewDriftAnnotation(metadata)) {
    if (
      driftCommentLabels === undefined ||
      handlers === undefined ||
      labels === undefined ||
      threadById === undefined ||
      locale === undefined
    ) {
      return null;
    }
    return createElement(DriftedComments, {
      driftCommentLabels,
      handlers,
      labels,
      threadById,
      threads: metadata.threads,
    });
  }
  if (isReviewDraftAnnotation(metadata)) {
    if (
      handlers === undefined ||
      labels === undefined ||
      locale === undefined
    ) {
      return null;
    }
    return createElement(InlineReviewDraftCard, {
      draftId: metadata.draftId,
      handlers,
      labels,
    });
  }
  return;
}
