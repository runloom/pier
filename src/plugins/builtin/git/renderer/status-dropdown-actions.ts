import type { RendererPluginContext } from "@plugins/api/renderer.ts";
import type { GitRemoteOperationResult } from "@shared/contracts/git.ts";
import { openSwitchBranchPick } from "./branch-actions.ts";
import {
  canContinuePausedOperation,
  pausedOperationName,
  runAbortPausedOperation,
  runContinuePausedOperation,
} from "./operation-runners.ts";
import { pluginText } from "./plugin-text.ts";
import type { RemoteSyncActionId } from "./remote-sync-policy.ts";
import type {
  GitStatusDropdownActionId,
  GitStatusDropdownModel,
} from "./status-dropdown-model.ts";
import { getInFlightSync, trackSync } from "./sync-busy.ts";
import { openWorktreeListQuickPick } from "./worktree/list-action.ts";

export type GitRemoteSyncActionId = RemoteSyncActionId;

function assertRemoteOperationOk(result: GitRemoteOperationResult): void {
  if (result.kind === "unavailable") {
    throw new Error(result.message ?? "git operation failed");
  }
}

const REMOTE_ACTION_FEEDBACK: Record<
  RemoteSyncActionId,
  {
    loadingFallback: string;
    loadingKey: string;
    successFallback: string;
    successKey: string;
  }
> = {
  fetch: {
    loadingFallback: "Fetching remote…",
    loadingKey: "statusDropdownFetching",
    successFallback: "Remote updated",
    successKey: "statusDropdownFetchSuccess",
  },
  publish: {
    loadingFallback: "Publishing branch…",
    loadingKey: "statusDropdownPublishing",
    successFallback: "Branch published",
    successKey: "statusDropdownPublishSuccess",
  },
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
};

function remoteFacadeCall(
  pluginContext: RendererPluginContext,
  actionId: RemoteSyncActionId,
  gitRoot: string
): Promise<GitRemoteOperationResult> {
  switch (actionId) {
    case "fetch":
      return pluginContext.git.fetch(gitRoot);
    case "publish":
      return pluginContext.git.publish(gitRoot);
    case "pull":
      return pluginContext.git.pullFastForward(gitRoot);
    case "push":
      return pluginContext.git.push(gitRoot);
    case "syncChanges":
      return pluginContext.git.sync(gitRoot);
    default: {
      const exhaustive: never = actionId;
      return exhaustive;
    }
  }
}

/**
 * 远端同步动作（浮层 / 状态栏 / 命令面板共用）。
 * key = gitRoot：同仓多面板共享 in-flight。
 */
export function runRemoteSyncAction(
  pluginContext: RendererPluginContext,
  actionId: RemoteSyncActionId,
  gitRoot: string
): Promise<void> {
  const existing = getInFlightSync(gitRoot);
  if (existing) {
    pluginContext.notifications.info(
      pluginText(
        pluginContext,
        "statusSyncAlreadyRunning",
        "Sync already in progress"
      )
    );
    // Joiners already got the "already in progress" toast. Swallow settle so
    // secondary palette / dropdown catch handlers do not open duplicate failure
    // UI when the shared owner promise rejects. The owner still sees the error.
    return existing.then(
      () => undefined,
      () => undefined
    );
  }
  return trackSync(gitRoot, async () => {
    const feedback = REMOTE_ACTION_FEEDBACK[actionId];
    const loading = pluginContext.notifications.loading(
      pluginText(pluginContext, feedback.loadingKey, feedback.loadingFallback)
    );
    try {
      assertRemoteOperationOk(
        await remoteFacadeCall(pluginContext, actionId, gitRoot)
      );
      loading.success(
        pluginText(pluginContext, feedback.successKey, feedback.successFallback)
      );
    } catch (error) {
      loading.dismiss();
      // Keep host message (hook stderr tail etc.) for alert body presentation.
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
    actionId === "syncChanges" ||
    actionId === "publish" ||
    actionId === "fetch"
  ) {
    await runRemoteSyncAction(pluginContext, actionId, model.gitRoot);
    return;
  }

  if (actionId === "abortOperation") {
    if (model.operationKind === null) {
      return;
    }
    await runAbortPausedOperation(pluginContext, {
      cwd: model.gitRoot,
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
      cwd: model.gitRoot,
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
    await openSwitchBranchPick(pluginContext, { cwd: model.gitRoot });
    return;
  }

  if (actionId === "switchWorktree") {
    await openWorktreeListQuickPick(pluginContext, model.gitRoot);
    return;
  }

  if (actionId === "viewChanges") {
    return;
  }

  const exhaustive: never = actionId;
  return exhaustive;
}
