import type { RendererPluginContext } from "@plugins/api/renderer.ts";
import type { PanelContext } from "@shared/contracts/panel.ts";

export interface GitGutterReviewNavigateInput {
  readonly context: RendererPluginContext;
  /** 磁盘新侧 1-based 行号（gutter 语义）。 */
  readonly line: number;
  readonly panelContext: PanelContext;
  /** 相对 gitRoot 的路径（与 review index entry.path 一致）。 */
  readonly path: string;
}

/**
 * 打开或聚焦 uncommitted Git Changes，并 pendingReveal 到该行。
 *
 * 必须走 `context.git.openUncommittedChanges`（宿主打开 git 面板），
 * **不能** `context.panels.openInstance("pier.git.changes")`：
 * panels facade 只允许插件打开自身 manifest 声明的 panel。
 *
 * group 使用 allowGroupFallback：由 Changes 侧按 entry 实际 renderSlots
 * 在 unstaged → staged → conflict 中解析（纯 staged 文件不会误进 unstaged）。
 */
export function navigateGitGutterToReview(
  input: GitGutterReviewNavigateInput
): boolean {
  const git = input.context.git;
  if (!git?.openUncommittedChanges) {
    return false;
  }
  return git.openUncommittedChanges({
    panelContext: input.panelContext,
    pendingReveal: {
      allowGroupFallback: true,
      line: input.line,
      path: input.path,
      side: "new",
    },
  });
}
