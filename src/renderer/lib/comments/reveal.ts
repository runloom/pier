/**
 * 评论跳转分发：git → Changes；markdown/canvas 步骤 1 为 unsupported stub。
 */
import type { PanelContext } from "@shared/contracts/panel.ts";
import {
  allocateCommentRevealNonce,
  openGitChangesForComments,
} from "./open-git-changes.ts";
import type { ProcessableCommentItem } from "./processable.ts";

export type RevealCommentResult =
  | { readonly kind: "opened" }
  | { readonly kind: "failed" }
  | { readonly kind: "unsupported"; readonly targetKind: "markdown" | "canvas" }
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

export function revealComment(input: RevealCommentInput): RevealCommentResult {
  const { item } = input;
  if (item.kind === "markdown" || item.kind === "canvas") {
    return { kind: "unsupported", targetKind: item.kind };
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
