import type { RendererPluginContext } from "@plugins/api/renderer.ts";
import type { GitRemoteOperationResult } from "@shared/contracts/git.ts";
import { openSwitchBranchPick } from "./git-branch-actions.ts";
import { pluginText } from "./git-plugin-text.ts";
import type {
  GitStatusDropdownActionId,
  GitStatusDropdownModel,
} from "./git-status-dropdown-model.ts";
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

async function runRemoteAction(
  pluginContext: RendererPluginContext,
  actionId: keyof typeof REMOTE_ACTION_FEEDBACK,
  run: () => Promise<GitRemoteOperationResult>
): Promise<void> {
  const feedback = REMOTE_ACTION_FEEDBACK[actionId];
  const loading = pluginContext.notifications.loading(
    pluginText(pluginContext, feedback.loadingKey, feedback.loadingFallback)
  );
  try {
    assertRemoteOperationOk(await run());
    loading.success(
      pluginText(pluginContext, feedback.successKey, feedback.successFallback)
    );
  } catch (error) {
    loading.dismiss();
    throw error;
  }
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
  if (actionId === "push") {
    await runRemoteAction(pluginContext, actionId, () =>
      pluginContext.git.push(model.worktreePath)
    );
    return;
  }

  if (actionId === "pull") {
    await runRemoteAction(pluginContext, actionId, () =>
      pluginContext.git.pullFastForward(model.worktreePath)
    );
    return;
  }

  if (actionId === "syncChanges") {
    await runRemoteAction(pluginContext, actionId, () =>
      pluginContext.git.sync(model.worktreePath)
    );
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

  const exhaustive: never = actionId;
  return exhaustive;
}
