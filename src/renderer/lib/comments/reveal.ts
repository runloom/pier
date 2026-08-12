/**
 * 评论跳转分发：git → Changes；markdown / canvas → 文件预览。
 */
import type { PanelContext } from "@shared/contracts/panel.ts";
import { openCanvasForComment } from "./open-canvas.ts";
import {
  allocateCommentRevealNonce,
  openGitChangesForComments,
} from "./open-git-changes.ts";
import { openMarkdownForComment } from "./open-markdown.ts";
import type { ProcessableCommentItem } from "./processable.ts";

export type RevealCommentResult =
  | { readonly kind: "opened" }
  | { readonly kind: "failed" }
  | { readonly kind: "stale-git" };

export interface RevealCommentInput {
  readonly context: PanelContext;
  readonly getGroupId?: (() => string | null) | null;
  /**
   * git 项 path 是否仍在 livePaths。false 时返回 stale-git（调用方负责删评论）。
   * 非 git 忽略。
   */
  readonly gitPathLive?: boolean;
  readonly item: ProcessableCommentItem;
}

function revealRoot(context: PanelContext): string | null {
  return (
    context.worktreeKey ??
    context.worktreeRoot ??
    context.gitRoot ??
    context.projectRootPath ??
    null
  );
}

export function revealComment(input: RevealCommentInput): RevealCommentResult {
  const { item } = input;
  if (item.kind === "canvas") {
    const root = revealRoot(input.context);
    if (!root) {
      return { kind: "failed" };
    }
    const opened = openCanvasForComment({
      context: input.context,
      path: item.path,
      root,
      ...(item.anchorId === undefined ? {} : { anchorId: item.anchorId }),
    });
    allocateCommentRevealNonce();
    return opened ? { kind: "opened" } : { kind: "failed" };
  }
  if (item.kind === "markdown") {
    const root = revealRoot(input.context);
    if (!root) {
      return { kind: "failed" };
    }
    const opened = openMarkdownForComment({
      context: input.context,
      path: item.path,
      root,
      ...(item.headingId === undefined ? {} : { headingId: item.headingId }),
      startLine: item.startLine,
    });
    // nonce reserved for future panel-param dedupe with git
    allocateCommentRevealNonce();
    return opened ? { kind: "opened" } : { kind: "failed" };
  }
  if (input.gitPathLive === false) {
    return { kind: "stale-git" };
  }
  const opened = openGitChangesForComments({
    context: input.context,
    ...(input.getGroupId ? { getGroupId: input.getGroupId } : {}),
    pendingReveal: {
      allowGroupFallback: true,
      group: item.group,
      line: item.line,
      nonce: allocateCommentRevealNonce(),
      path: item.path,
      side: item.side,
    },
  });
  return opened ? { kind: "opened" } : { kind: "failed" };
}
