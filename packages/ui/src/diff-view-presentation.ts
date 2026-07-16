/** Diff item 呈现态：与 Pierre FileDiff 内容是否就绪解耦。 */
export type PierDiffItemPresentation = "loading" | "ready";

export function pierDiffItemPresentation(input: {
  readonly patch: string | null;
}): PierDiffItemPresentation {
  return input.patch === null ? "loading" : "ready";
}

/**
 * Collapse chevron 旋转条件。
 * DiffsHub 对 ready 空 diff 使用 disabled||collapsed；
 * loading 不得复用该视觉，否则懒加载会被读成“收起列表”。
 */
export function shouldRotateCollapseChevron(options: {
  readonly collapsed: boolean;
  readonly disabled: boolean;
  readonly loading: boolean;
}): boolean {
  if (options.loading) {
    return false;
  }
  return options.disabled || options.collapsed;
}

/** 仅真实 hunk 行统计 >0 时展示 header count。 */
export function shouldRenderDiffLineStats(stats: {
  readonly additions: number;
  readonly deletions: number;
}): boolean {
  return stats.additions > 0 || stats.deletions > 0;
}
