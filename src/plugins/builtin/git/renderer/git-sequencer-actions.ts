import type { RendererPluginContext } from "@plugins/api/renderer.ts";
import type {
  GitSequencerAbortResult,
  GitSequencerContinueResult,
  GitSequencerResult,
  GitUndoCommitResult,
} from "@shared/contracts/git.ts";
import { GitCommitHorizontal, Undo2 } from "lucide-react";
import {
  activeCwdOrMessage,
  commandTitle,
  confirmDialog,
  disabledReasonForActiveGit,
  enabledForActiveGit,
  showConflictDetails,
  showError,
  showLoading,
  showUnavailable,
} from "./git-command-helpers.ts";
import { openCommitPick } from "./git-commit-pick.ts";
import { shortCommitHash } from "./git-commit-quick-pick-row.tsx";
import { pluginText } from "./git-plugin-text.ts";

interface SequencerActionText {
  readonly commandFallback: string;
  readonly commandId: string;
  readonly conflictBodyFallback: string;
  readonly conflictBodyKey: string;
  readonly conflictTitleFallback: string;
  readonly conflictTitleKey: string;
  readonly loadingFallback: string;
  readonly loadingKey: string;
  readonly successFallback: string;
  readonly successKey: string;
}

/** cherry-pick / revert 执行动作:commit quick-pick 选目标,冲突时提示解决。 */
function registerSequencerRunAction(
  context: RendererPluginContext,
  text: SequencerActionText,
  run: (cwd: string, oid: string) => Promise<GitSequencerResult>,
  sortOrder: number
): () => void {
  return context.actions.register({
    category: "Git",
    disabledReason: () => disabledReasonForActiveGit(context),
    enabled: () => enabledForActiveGit(context),
    handler: () => {
      const title = commandTitle(context, text.commandId, text.commandFallback);
      const cwd = activeCwdOrMessage(context, title);
      if (!cwd) {
        return;
      }
      openCommitPick(context, {
        cwd,
        onPick: async (commit) => {
          const loading = showLoading(
            context,
            pluginText(context, text.loadingKey, text.loadingFallback)
          );
          let result: GitSequencerResult;
          try {
            result = await run(cwd, commit.hash);
          } catch (err) {
            loading.dismiss();
            await showError(context, title, err);
            return;
          }
          if (result.kind === "ok") {
            loading.success(
              pluginText(context, text.successKey, text.successFallback, {
                commit: shortCommitHash(commit.hash),
              })
            );
          } else if (result.kind === "conflict") {
            loading.dismiss();
            await showConflictDetails(
              context,
              pluginText(
                context,
                text.conflictTitleKey,
                text.conflictTitleFallback
              ),
              pluginText(
                context,
                text.conflictBodyKey,
                text.conflictBodyFallback
              ),
              result.message
            );
          } else {
            loading.dismiss();
            await showUnavailable(context, title, result.message?.trim());
          }
        },
        title,
      });
    },
    id: text.commandId,
    metadata: {
      categoryKey: "git",
      group: "2_git",
      iconComponent: GitCommitHorizontal,
      sortOrder,
    },
    surfaces: ["command-palette"],
    title: () => commandTitle(context, text.commandId, text.commandFallback),
  });
}

interface SequencerFollowUpText {
  readonly commandFallback: string;
  readonly commandId: string;
  readonly loadingFallback: string;
  readonly loadingKey: string;
  readonly successFallback: string;
  readonly successKey: string;
}

function registerSequencerAbortAction(
  context: RendererPluginContext,
  text: SequencerFollowUpText,
  run: (cwd: string) => Promise<GitSequencerAbortResult>,
  sortOrder: number
): () => void {
  return context.actions.register({
    category: "Git",
    disabledReason: () => disabledReasonForActiveGit(context),
    enabled: () => enabledForActiveGit(context),
    handler: async () => {
      const title = commandTitle(context, text.commandId, text.commandFallback);
      const cwd = activeCwdOrMessage(context, title);
      if (!cwd) {
        return;
      }
      const loading = showLoading(
        context,
        pluginText(context, text.loadingKey, text.loadingFallback)
      );
      let result: GitSequencerAbortResult;
      try {
        result = await run(cwd);
      } catch (err) {
        loading.dismiss();
        await showError(context, title, err);
        return;
      }
      if (result.kind === "ok") {
        loading.success(
          pluginText(context, text.successKey, text.successFallback)
        );
      } else {
        loading.dismiss();
        await showUnavailable(context, title, result.message?.trim());
      }
    },
    id: text.commandId,
    metadata: {
      categoryKey: "git",
      group: "2_git",
      iconComponent: GitCommitHorizontal,
      sortOrder,
    },
    surfaces: ["command-palette"],
    title: () => commandTitle(context, text.commandId, text.commandFallback),
  });
}

function registerSequencerContinueAction(
  context: RendererPluginContext,
  text: SequencerFollowUpText & {
    readonly conflictBodyFallback: string;
    readonly conflictBodyKey: string;
    readonly conflictTitleFallback: string;
    readonly conflictTitleKey: string;
  },
  run: (cwd: string) => Promise<GitSequencerContinueResult>,
  sortOrder: number
): () => void {
  return context.actions.register({
    category: "Git",
    disabledReason: () => disabledReasonForActiveGit(context),
    enabled: () => enabledForActiveGit(context),
    handler: async () => {
      const title = commandTitle(context, text.commandId, text.commandFallback);
      const cwd = activeCwdOrMessage(context, title);
      if (!cwd) {
        return;
      }
      const loading = showLoading(
        context,
        pluginText(context, text.loadingKey, text.loadingFallback)
      );
      let result: GitSequencerContinueResult;
      try {
        result = await run(cwd);
      } catch (err) {
        loading.dismiss();
        await showError(context, title, err);
        return;
      }
      if (result.kind === "ok") {
        loading.success(
          pluginText(context, text.successKey, text.successFallback)
        );
      } else if (result.kind === "conflict") {
        loading.dismiss();
        await showConflictDetails(
          context,
          pluginText(
            context,
            text.conflictTitleKey,
            text.conflictTitleFallback
          ),
          pluginText(context, text.conflictBodyKey, text.conflictBodyFallback),
          result.message
        );
      } else {
        loading.dismiss();
        await showUnavailable(context, title, result.message?.trim());
      }
    },
    id: text.commandId,
    metadata: {
      categoryKey: "git",
      group: "2_git",
      iconComponent: GitCommitHorizontal,
      sortOrder,
    },
    surfaces: ["command-palette"],
    title: () => commandTitle(context, text.commandId, text.commandFallback),
  });
}

export function registerCherryPickActions(
  context: RendererPluginContext
): () => void {
  const disposers = [
    registerSequencerRunAction(
      context,
      {
        commandFallback: "Git: Cherry-pick Commit...",
        commandId: "pier.git.cherryPick",
        conflictBodyFallback:
          "Cherry-pick paused due to conflicts. Resolve them, then continue.",
        conflictBodyKey: "gitCherryPickConflict",
        conflictTitleFallback: "Cherry-pick Conflicts",
        conflictTitleKey: "gitCherryPickConflictTitle",
        loadingFallback: "Cherry-picking...",
        loadingKey: "gitLoadingCherryPick",
        successFallback: "Cherry-picked {{commit}}",
        successKey: "gitCherryPickSuccess",
      },
      (cwd, oid) => context.git.cherryPick(cwd, oid),
      21
    ),
    registerSequencerAbortAction(
      context,
      {
        commandFallback: "Git: Abort Cherry-pick",
        commandId: "pier.git.cherryPickAbort",
        loadingFallback: "Aborting cherry-pick...",
        loadingKey: "gitLoadingCherryPickAbort",
        successFallback: "Cherry-pick aborted",
        successKey: "gitCherryPickAbortSuccess",
      },
      (cwd) => context.git.abortCherryPick(cwd),
      22
    ),
    registerSequencerContinueAction(
      context,
      {
        commandFallback: "Git: Continue Cherry-pick",
        commandId: "pier.git.cherryPickContinue",
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
      (cwd) => context.git.continueCherryPick(cwd),
      23
    ),
  ];
  return () => {
    for (const dispose of disposers) {
      dispose();
    }
  };
}

export function registerRevertActions(
  context: RendererPluginContext
): () => void {
  const disposers = [
    registerSequencerRunAction(
      context,
      {
        commandFallback: "Git: Revert Commit...",
        commandId: "pier.git.revert",
        conflictBodyFallback:
          "Revert paused due to conflicts. Resolve them, then continue.",
        conflictBodyKey: "gitRevertConflict",
        conflictTitleFallback: "Revert Conflicts",
        conflictTitleKey: "gitRevertConflictTitle",
        loadingFallback: "Reverting...",
        loadingKey: "gitLoadingRevert",
        successFallback: "Reverted {{commit}}",
        successKey: "gitRevertSuccess",
      },
      (cwd, oid) => context.git.revert(cwd, oid),
      24
    ),
    registerSequencerAbortAction(
      context,
      {
        commandFallback: "Git: Abort Revert",
        commandId: "pier.git.revertAbort",
        loadingFallback: "Aborting revert...",
        loadingKey: "gitLoadingRevertAbort",
        successFallback: "Revert aborted",
        successKey: "gitRevertAbortSuccess",
      },
      (cwd) => context.git.abortRevert(cwd),
      25
    ),
    registerSequencerContinueAction(
      context,
      {
        commandFallback: "Git: Continue Revert",
        commandId: "pier.git.revertContinue",
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
      (cwd) => context.git.continueRevert(cwd),
      26
    ),
  ];
  return () => {
    for (const dispose of disposers) {
      dispose();
    }
  };
}

export function registerUndoCommitAction(
  context: RendererPluginContext
): () => void {
  return context.actions.register({
    category: "Git",
    disabledReason: () => disabledReasonForActiveGit(context),
    enabled: () => enabledForActiveGit(context),
    handler: async () => {
      const title = commandTitle(
        context,
        "pier.git.undoLastCommit",
        "Git: Undo Last Commit"
      );
      const cwd = activeCwdOrMessage(context, title);
      if (!cwd) {
        return;
      }
      const confirmed = await confirmDialog(
        context,
        title,
        pluginText(
          context,
          "gitUndoCommitConfirm",
          "Undo the last commit? Changes will be preserved as staged."
        ),
        pluginText(context, "gitUndoCommitConfirmButton", "Undo"),
        undefined,
        { intent: "destructive" }
      );
      if (!confirmed) {
        return;
      }
      const loading = showLoading(
        context,
        pluginText(context, "gitLoadingUndoCommit", "Undoing commit...")
      );
      let result: GitUndoCommitResult;
      try {
        result = await context.git.undoLastCommit(cwd);
      } catch (err) {
        loading.dismiss();
        await showError(context, title, err);
        return;
      }
      if (result.kind === "ok") {
        loading.success(
          pluginText(
            context,
            "gitUndoCommitSuccess",
            "Last commit undone (changes preserved as staged)"
          )
        );
      } else if (result.kind === "nothing_to_undo") {
        loading.info(
          pluginText(context, "gitUndoCommitNothing", "No commits to undo")
        );
      } else {
        loading.dismiss();
        await showUnavailable(context, title, result.message?.trim());
      }
    },
    id: "pier.git.undoLastCommit",
    metadata: {
      categoryKey: "git",
      group: "2_git",
      iconComponent: Undo2,
      sortOrder: 20,
    },
    surfaces: ["command-palette"],
    title: () =>
      commandTitle(context, "pier.git.undoLastCommit", "Git: Undo Last Commit"),
  });
}
