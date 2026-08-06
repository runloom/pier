import type {
  PierDiffReviewCommentThread,
  PierDriftCommentLabels,
} from "@pier/ui/diff-view/index.tsx";
import type { RendererPluginContext } from "@plugins/api/renderer.ts";
import { useMemo } from "react";
import { pluginText } from "../plugin-text.ts";
import type { ReviewDocumentProjection } from "../review/document/projection.ts";

/**
 * gutter 评论入口数据 + 文案绑定。
 *
 * `reviewCommentsById`：从 `projection.items` 收集有评论的文件建稀疏索引
 * （itemId → 该文件 diff 行内评论线程），gutter 查不到 → 不渲染入口。
 * `driftCommentLabels`：文件级 drift chip 文案（locale 切换时重建）。
 * gutter `+` 入口是 `@pierre/diffs` 原生按钮，不需宿主文案。
 */
export function useGitReviewGutterBindings({
  context,
  locale,
  projection,
}: {
  readonly context: RendererPluginContext;
  readonly locale: string;
  readonly projection: ReviewDocumentProjection;
}): {
  readonly driftCommentLabels: PierDriftCommentLabels;
  readonly reviewCommentsById: ReadonlyMap<
    string,
    readonly PierDiffReviewCommentThread[]
  >;
} {
  const reviewCommentsById = useMemo(() => {
    const map = new Map<string, readonly PierDiffReviewCommentThread[]>();
    for (const item of projection.items) {
      if (item.reviewComments && item.reviewComments.length > 0) {
        map.set(item.id, item.reviewComments);
      }
    }
    return map;
  }, [projection]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: locale drives i18n re-read
  const driftCommentLabels = useMemo<PierDriftCommentLabels>(
    () => ({
      driftedLineComment: pluginText(
        context,
        "reviewDriftedLineComment",
        "Comment on line {{line}} can no longer be located"
      ),
      driftedLineLabel: pluginText(
        context,
        "reviewDriftedLineLabel",
        "Line {{line}}"
      ),
      fileComment: pluginText(context, "reviewFileComment", "File comment"),
      fileLabel: pluginText(context, "reviewDriftFileLabel", "File comment"),
      sectionHeading: pluginText(
        context,
        "reviewDriftSectionHeading",
        "Code changed"
      ),
    }),
    [context, locale]
  );
  return { driftCommentLabels, reviewCommentsById };
}
