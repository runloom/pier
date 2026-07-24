import type { RendererPluginContext } from "@plugins/api/renderer.ts";
import type { GitRemoteOperationResult } from "@shared/contracts/git.ts";
import { openSwitchBranchPick } from "./git-branch-actions.ts";
import {
  canContinuePausedOperation,
  pausedOperationName,
  runAbortPausedOperation,
  runContinuePausedOperation,
} from "./git-operation-runners.ts";
import { pluginText } from "./git-plugin-text.ts";
import type {
  GitStatusDropdownActionId,
  GitStatusDropdownModel,
} from "./git-status-dropdown-model.ts";
import { getInFlightSync, trackSync } from "./git-sync-busy.ts";
import { openWorktreeListQuickPick } from "./worktree-list-action.ts";

export function gitStatusDropdownErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function assertRemoteOperationOk(result: GitRemoteOperationResult): void {
  if (result.kind === "unavailable") {
    throw new Error(result.message ?? "Git operation failed");
  }
}

const REMOTE_ACTION_FEEDBACK = {
  pull: {
    loadingFallback: "Pulling changes…",
    loadingKey: "statusDropdownPulling",
    successFallback: "Changes pulled",
    successKey: "statusDropdownPullSuccess",
  },
  push: {
    loadingFallback: "Pushing changes…",
    loadingKey: "statusDropdownPushing",
    successFallback: "Changes pushed",
    successKey: "statusDropdownPushSuccess",
  },
  syncChanges: {
    loadingFallback: "Syncing changes…",
    loadingKey: "statusDropdownSyncing",
    successFallback: "Changes synced",
    successKey: "statusDropdownSyncSuccess",
  },
} as const;

export type GitRemoteSyncActionId = keyof typeof REMOTE_ACTION_FEEDBACK;

function remoteFacadeCall(
  pluginContext: RendererPluginContext,
  actionId: GitRemoteSyncActionId,
  worktreePath: string
): Promise<GitRemoteOperationResult> {
  switch (actionId) {
    case "pull":
      return pluginContext.git.pullFastForward(worktreePath);
    case "push":
      return pluginContext.git.push(worktreePath);
    case "syncChanges":
      return pluginContext.git.sync(worktreePath);
    default: {
      const exhaustive: never = actionId;
      return exhaustive;
    }
  }
}

/**
 * 远端同步动作（浮层同步行与状态栏同步项共用）：
 * 同一工作树并发去重——已有 in-flight 时提示并复用同一 promise。
 */
export function runRemoteSyncAction(
  pluginContext: RendererPluginContext,
  actionId: GitRemoteSyncActionId,
  worktreePath: string
): Promise<void> {
  const existing = getInFlightSync(worktreePath);
  if (existing) {
    pluginContext.notifications.info(
      pluginText(
        pluginContext,
        "statusSyncAlreadyRunning",
        "Sync already in progress"
      )
    );
    return existing;
  }
  return trackSync(worktreePath, async () => {
    const feedback = REMOTE_ACTION_FEEDBACK[actionId];
    const loading = pluginContext.notifications.loading(
      pluginText(pluginContext, feedback.loadingKey, feedback.loadingFallback)
    );
    try {
      assertRemoteOperationOk(
        await remoteFacadeCall(pluginContext, actionId, worktreePath)
      );
      loading.success(
        pluginText(pluginContext, feedback.successKey, feedback.successFallback)
      );
    } catch (error) {
      loading.dismiss();
      throw error;
    }
  });
}

export async function runGitStatusDropdownAction({
  actionId,
  model,
  pluginContext,
}: {
  actionId: GitStatusDropdownActionId;
  model: GitStatusDropdownModel;
  pluginContext: RendererPluginContext;
}): Promise<void> {
  if (
    actionId === "push" ||
    actionId === "pull" ||
    actionId === "syncChanges"
  ) {
    await runRemoteSyncAction(pluginContext, actionId, model.worktreePath);
    return;
  }

  if (actionId === "abortOperation") {
    if (model.operationKind === null) {
      return;
    }
    await runAbortPausedOperation(pluginContext, {
      cwd: model.worktreePath,
      kind: model.operationKind,
      title: pluginText(
        pluginContext,
        "gitAbortOperationConfirmButton",
        "Abort {{operation}}",
        { operation: pausedOperationName(pluginContext, model.operationKind) }
      ),
    });
    return;
  }

  if (actionId === "continueOperation") {
    if (
      model.operationKind === null ||
      !canContinuePausedOperation(model.operationKind)
    ) {
      return;
    }
    await runContinuePausedOperation(pluginContext, {
      cwd: model.worktreePath,
      kind: model.operationKind,
      title: pluginText(
        pluginContext,
        "statusRowContinueOperation",
        "Continue {{operation}}",
        { operation: pausedOperationName(pluginContext, model.operationKind) }
      ),
    });
    return;
  }

  if (actionId === "switchBranch") {
    await openSwitchBranchPick(pluginContext, { cwd: model.worktreePath });
    return;
  }

  if (actionId === "switchWorktree") {
    await openWorktreeListQuickPick(pluginContext, model.worktreePath);
    return;
  }

  if (actionId === "viewChanges") {
    return;
  }

  const exhaustive: never = actionId;
  return exhaustive;
}
