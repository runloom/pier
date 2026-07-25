import type { RendererPluginContext } from "@plugins/api/renderer.ts";
import type {
  GitMergeAbortResult,
  GitRebaseAbortResult,
  GitRebaseContinueResult,
  GitRepoState,
  GitSequencerAbortResult,
  GitSequencerContinueResult,
} from "@shared/contracts/git.ts";
import {
  confirmDialog,
  showConflictDetails,
  showError,
  showLoading,
  showUnavailable,
} from "./git-command-helpers.ts";
import { pluginText } from "./git-plugin-text.ts";

/**
 * cwd 参数化的「继续 / 中止暂停操作」runner:命令面板与状态栏浮层共用同一条
 * 反馈路径(loading toast → success / conflict alert / unavailable alert)。
 * bisect 由终端主导,不在此收敛。
 */
export type GitPausedOperationKind = Exclude<
  GitRepoState["kind"],
  "bisecting" | "clean"
>;

/** merge 没有 continue 语义(解决冲突后走 commit),其余暂停操作可继续。 */
export function canContinuePausedOperation(
  kind: GitPausedOperationKind
): kind is Exclude<GitPausedOperationKind, "merging"> {
  return kind !== "merging";
}

const OPERATION_NAME_TEXT: Record<
  GitPausedOperationKind,
  { readonly fallback: string; readonly key: string }
> = {
  "cherry-picking": {
    fallback: "Cherry-pick",
    key: "statusDropdownOperationCherryPick",
  },
  merging: { fallback: "Merge", key: "statusDropdownOperationMerge" },
  rebasing: { fallback: "Rebase", key: "statusDropdownOperationRebase" },
  reverting: { fallback: "Revert", key: "statusDropdownOperationRevert" },
};

export function pausedOperationName(
  context: RendererPluginContext,
  kind: GitPausedOperationKind
): string {
  const text = OPERATION_NAME_TEXT[kind];
  return pluginText(context, text.key, text.fallback);
}

interface OperationFeedbackText {
  readonly loadingFallback: string;
  readonly loadingKey: string;
  readonly successFallback: string;
  readonly successKey: string;
}

type AbortResult =
  | GitMergeAbortResult
  | GitRebaseAbortResult
  | GitSequencerAbortResult;

const ABORT_TEXT: Record<GitPausedOperationKind, OperationFeedbackText> = {
  "cherry-picking": {
    loadingFallback: "Aborting cherry-pick...",
    loadingKey: "gitLoadingCherryPickAbort",
    successFallback: "Cherry-pick aborted",
    successKey: "gitCherryPickAbortSuccess",
  },
  merging: {
    loadingFallback: "Aborting merge...",
    loadingKey: "gitLoadingMergeAbort",
    successFallback: "Merge aborted",
    successKey: "gitMergeAbortSuccess",
  },
  rebasing: {
    loadingFallback: "Aborting rebase...",
    loadingKey: "gitLoadingRebaseAbort",
    successFallback: "Rebase aborted",
    successKey: "gitRebaseAbortSuccess",
  },
  reverting: {
    loadingFallback: "Aborting revert...",
    loadingKey: "gitLoadingRevertAbort",
    successFallback: "Revert aborted",
    successKey: "gitRevertAbortSuccess",
  },
};

function runAbort(
  context: RendererPluginContext,
  cwd: string,
  kind: GitPausedOperationKind
): Promise<AbortResult> {
  switch (kind) {
    case "cherry-picking":
      return context.git.abortCherryPick(cwd);
    case "merging":
      return context.git.abortMerge(cwd);
    case "rebasing":
      return context.git.abortRebase(cwd);
    case "reverting":
      return context.git.abortRevert(cwd);
    default: {
      const exhaustive: never = kind;
      return exhaustive;
    }
  }
}

/**
 * 中止暂停操作。破坏性动作:先弹 destructive confirm,确认后执行并给出
 * loading/success/unavailable 反馈。
 */
export async function runAbortPausedOperation(
  context: RendererPluginContext,
  options: {
    readonly cwd: string;
    readonly kind: GitPausedOperationKind;
    readonly title: string;
  }
): Promise<void> {
  const operation = pausedOperationName(context, options.kind);
  const confirmed = await confirmDialog(
    context,
    pluginText(
      context,
      "gitAbortOperationConfirmTitle",
      "Abort {{operation}}?",
      {
        operation,
      }
    ),
    pluginText(
      context,
      "gitAbortOperationConfirmBody",
      "This discards the paused {{operation}} and returns the branch to its previous state.",
      { operation }
    ),
    pluginText(
      context,
      "gitAbortOperationConfirmButton",
      "Abort {{operation}}",
      { operation }
    ),
    undefined,
    { intent: "destructive", size: "sm" }
  );
  if (!confirmed) {
    return;
  }
  const text = ABORT_TEXT[options.kind];
  const loading = showLoading(
    context,
    pluginText(context, text.loadingKey, text.loadingFallback)
  );
  let result: AbortResult;
  try {
    result = await runAbort(context, options.cwd, options.kind);
  } catch (err) {
    loading.dismiss();
    await showError(context, options.title, err);
    return;
  }
  if (result.kind === "ok") {
    loading.success(pluginText(context, text.successKey, text.successFallback));
  } else {
    loading.dismiss();
    await showUnavailable(context, options.title, result.message?.trim());
  }
}

export type GitContinuablePausedOperationKind = Exclude<
  GitPausedOperationKind,
  "merging"
>;

interface ContinueFeedbackText extends OperationFeedbackText {
  readonly conflictBodyFallback: string;
  readonly conflictBodyKey: string;
  readonly conflictTitleFallback: string;
  readonly conflictTitleKey: string;
}

type ContinueResult = GitRebaseContinueResult | GitSequencerContinueResult;

const CONTINUE_TEXT: Record<
  GitContinuablePausedOperationKind,
  ContinueFeedbackText
> = {
  "cherry-picking": {
    conflictBodyFallback:
      "Cherry-pick still has conflicts. Resolve them, then continue.",
    conflictBodyKey: "gitCherryPickContinueConflict",
    conflictTitleFallback: "Cherry-pick Conflicts",
    conflictTitleKey: "gitCherryPickConflictTitle",
    loadingFallback: "Continuing cherry-pick...",
    loadingKey: "gitLoadingCherryPickContinue",
    successFallback: "Cherry-pick continued",
    successKey: "gitCherryPickContinueSuccess",
  },
  rebasing: {
    conflictBodyFallback:
      "Rebase still has conflicts. Resolve them, then continue.",
    conflictBodyKey: "gitRebaseContinueConflict",
    conflictTitleFallback: "Rebase Conflicts",
    conflictTitleKey: "gitRebaseConflictTitle",
    loadingFallback: "Continuing rebase...",
    loadingKey: "gitLoadingRebaseContinue",
    successFallback: "Rebase continued",
    successKey: "gitRebaseContinueSuccess",
  },
  reverting: {
    conflictBodyFallback:
      "Revert still has conflicts. Resolve them, then continue.",
    conflictBodyKey: "gitRevertContinueConflict",
    conflictTitleFallback: "Revert Conflicts",
    conflictTitleKey: "gitRevertConflictTitle",
    loadingFallback: "Continuing revert...",
    loadingKey: "gitLoadingRevertContinue",
    successFallback: "Revert continued",
    successKey: "gitRevertContinueSuccess",
  },
};

function runContinue(
  context: RendererPluginContext,
  cwd: string,
  kind: GitContinuablePausedOperationKind
): Promise<ContinueResult> {
  switch (kind) {
    case "cherry-picking":
      return context.git.continueCherryPick(cwd);
    case "rebasing":
      return context.git.continueRebase(cwd);
    case "reverting":
      return context.git.continueRevert(cwd);
    default: {
      const exhaustive: never = kind;
      return exhaustive;
    }
  }
}

/** 继续暂停操作:成功 toast,仍有冲突时给出可读详情。 */
export async function runContinuePausedOperation(
  context: RendererPluginContext,
  options: {
    readonly cwd: string;
    readonly kind: GitContinuablePausedOperationKind;
    readonly title: string;
  }
): Promise<void> {
  const text = CONTINUE_TEXT[options.kind];
  const loading = showLoading(
    context,
    pluginText(context, text.loadingKey, text.loadingFallback)
  );
  let result: ContinueResult;
  try {
    result = await runContinue(context, options.cwd, options.kind);
  } catch (err) {
    loading.dismiss();
    await showError(context, options.title, err);
    return;
  }
  if (result.kind === "ok") {
    loading.success(pluginText(context, text.successKey, text.successFallback));
  } else if (result.kind === "conflict") {
    loading.dismiss();
    await showConflictDetails(
      context,
      pluginText(context, text.conflictTitleKey, text.conflictTitleFallback),
      pluginText(context, text.conflictBodyKey, text.conflictBodyFallback),
      result.message
    );
  } else {
    loading.dismiss();
    await showUnavailable(context, options.title, result.message?.trim());
  }
}
