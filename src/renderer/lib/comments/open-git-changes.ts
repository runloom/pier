import type {
  GitReviewGroup,
  GitReviewScope,
} from "@shared/contracts/git/review.ts";
import type { PanelContext } from "@shared/contracts/panel.ts";
import { useWorkspaceStore } from "@/stores/workspace.store.ts";
import { openPluginPanelInstance } from "../plugins/host/panel-instance-open.ts";
import { getPluginPanelRegistrations } from "../plugins/panel-registry.ts";

/**
 * 与 git 插件 GIT_CHANGES_PANEL_ID 对齐；宿主不 import 插件包
 *（仿 openFilesDiskPath 的 FILES_FILE_PANEL_COMPONENT_ID 模式）。
 */
export const GIT_CHANGES_PANEL_COMPONENT_ID = "pier.git.changes";

/**
 * 评论 reveal 跳转意图（状态栏 → git changes 面板）。宿主侧透传结构，
 * 与 git 插件 PendingCommentReveal 同构；插件侧 readPendingReveal 校验。
 */
export interface CommentRevealTarget {
  readonly group: GitReviewGroup;
  readonly line: number;
  readonly nonce: number;
  readonly path: string;
  readonly side: "new" | "old";
}

/** Process-wide monotonic nonce — must not reset per dialog mount (panel dedupes by nonce). */
let nextCommentRevealNonce = 1;

export function allocateCommentRevealNonce(): number {
  const nonce = nextCommentRevealNonce;
  nextCommentRevealNonce += 1;
  return nonce;
}

export function resetCommentRevealNonceForTests(): void {
  nextCommentRevealNonce = 1;
}

function isReviewSource(value: unknown): value is GitReviewScope {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const candidate = value as Partial<GitReviewScope>;
  return (
    typeof candidate.contextId === "string" &&
    typeof candidate.gitRootPath === "string" &&
    typeof candidate.target?.kind === "string"
  );
}

function sameReviewSource(
  left: GitReviewScope,
  right: GitReviewScope
): boolean {
  return (
    left.contextId === right.contextId &&
    left.gitRootPath === right.gitRootPath &&
    left.target.kind === right.target.kind
  );
}

/**
 * 宿主从评论状态栏打开 git changes 面板（core 打开插件 panel 范式，
 * 仿 openFilesDiskPath：检查注册 → 复用已存在同 source 实例 → openPluginPanelInstance）。
 *
 * - git 插件未注册时返回 false（静默 no-op，状态栏点击无反应）。
 * - 已打开同 source（contextId + gitRootPath + target）时复用实例并激活。
 * - v1 不滚动到具体评论：reveal comment 经事件总线留阶段 F 实现。
 */
export function openGitChangesForComments(input: {
  context: PanelContext;
  getGroupId?: (() => string | null) | null;
  pendingReveal?: CommentRevealTarget | null;
}): boolean {
  if (!getPluginPanelRegistrations().has(GIT_CHANGES_PANEL_COMPONENT_ID)) {
    return false;
  }
  const gitRootPath =
    input.context.gitRoot ??
    input.context.worktreeRoot ??
    input.context.projectRootPath;
  if (!gitRootPath) {
    return false;
  }
  const source: GitReviewScope = {
    contextId: input.context.contextId,
    gitRootPath,
    target: { kind: "uncommitted" },
  };
  const api = useWorkspaceStore.getState().api;
  const existing = api?.panels.find((panel) => {
    if (panel.view.contentComponent !== GIT_CHANGES_PANEL_COMPONENT_ID) {
      return false;
    }
    const params = panel.params as { source?: unknown } | undefined;
    return (
      params?.source !== undefined &&
      isReviewSource(params.source) &&
      sameReviewSource(params.source, source)
    );
  });
  const groupId = input.getGroupId?.() ?? null;
  const instanceId =
    existing?.id ??
    `${GIT_CHANGES_PANEL_COMPONENT_ID}:${source.contextId}:uncommitted`;
  const result = openPluginPanelInstance({
    componentId: GIT_CHANGES_PANEL_COMPONENT_ID,
    context: input.context,
    instanceId,
    params: {
      ...(input.pendingReveal === null || input.pendingReveal === undefined
        ? {}
        : { pendingReveal: input.pendingReveal }),
      source,
    },
    ...(groupId ? { targetGroupId: groupId } : {}),
  });
  return result.kind === "opened";
}
