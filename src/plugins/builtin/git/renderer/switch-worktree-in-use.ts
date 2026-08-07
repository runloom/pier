import type { RendererPluginContext } from "@plugins/api/renderer.ts";
import {
  isGitWorktreeInUseError,
  parseGitWorktreeInUseFromError,
} from "@shared/git/worktree-in-use.ts";
import { showError } from "./command-helpers.ts";
import { pluginText } from "./plugin-text.ts";

/** 切换失败：优先 worktree 占用友好提示，否则通用错误弹窗。 */
export async function handleSwitchBranchFailure(
  context: RendererPluginContext,
  commandTitle: string,
  requestedBranch: string,
  error: unknown
): Promise<void> {
  if (await handleSwitchWorktreeInUseError(context, requestedBranch, error)) {
    return;
  }
  await showError(context, commandTitle, error);
}

/**
 * 切换分支时若目标已被其他工作树占用：白话说明 +「打开该工作树」。
 * 返回 true 表示已处理（调用方勿再 showError）。
 */
export async function handleSwitchWorktreeInUseError(
  context: RendererPluginContext,
  requestedBranch: string,
  error: unknown
): Promise<boolean> {
  if (!isGitWorktreeInUseError(error)) {
    return false;
  }

  const match = parseGitWorktreeInUseFromError(error);
  const branch = match?.branch || requestedBranch;
  const path = match?.path ?? null;
  const rawDetail =
    error instanceof Error ? error.message.trim() : String(error).trim();

  const title = pluginText(
    context,
    "gitSwitchWorktreeInUseTitle",
    "Cannot switch to “{{branch}}”",
    { branch }
  );

  if (!path) {
    const friendly = pluginText(
      context,
      "gitSwitchWorktreeInUseBodyNoPath",
      "Branch “{{branch}}” is already open in another worktree. Use List Worktrees to open it, or switch that checkout to a different branch first.",
      { branch }
    );
    await context.dialogs.alert({
      body:
        rawDetail.length > 0 && rawDetail !== friendly
          ? `${friendly}\n\n${rawDetail}`
          : friendly,
      title,
    });
    return true;
  }

  const open = await context.dialogs.confirm({
    body: pluginText(
      context,
      "gitSwitchWorktreeInUseBody",
      "Branch “{{branch}}” is already open in another worktree:\n\n{{path}}\n\nOpen that worktree to continue, or switch it to a different branch first.",
      { branch, path }
    ),
    cancelLabel: pluginText(context, "gitSwitchWorktreeInUseDismiss", "Close"),
    confirmLabel: pluginText(
      context,
      "gitSwitchWorktreeInUseOpen",
      "Open Worktree"
    ),
    intent: "default",
    title,
  });

  if (!open) {
    return true;
  }

  try {
    await context.worktrees.open({ path });
  } catch (openError) {
    await context.dialogs.alert({
      body: openError instanceof Error ? openError.message : String(openError),
      title: pluginText(
        context,
        "worktreeOperationFailed",
        "Worktree operation failed"
      ),
    });
  }
  return true;
}
