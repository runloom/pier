/** Diff item 呈现态：与 Pierre FileDiff 内容是否就绪解耦。 */
export type PierDiffItemPresentation = "loading" | "ready";

export function pierDiffItemPresentation(input: {
  readonly patch: string | null;
  readonly stateNotice?: string;
  readonly kind?: "estimate" | "loaded" | "error" | "ready-notice";
}): PierDiffItemPresentation {
  // estimate = 正文未水合：header 显示 loading，禁止当成「已就绪的空文件」
  if (input.kind === "estimate") {
    return "loading";
  }
  if (input.kind === "error" || input.kind === "ready-notice") {
    return "ready";
  }
  if (input.stateNotice) {
    return "ready";
  }
  // 无 kind 的旧 patch:null：与 estimate 同为未就绪
  if (input.patch === null) {
    return "loading";
  }
  return "ready";
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
