import type { RendererPluginContext } from "@plugins/api/renderer.ts";
import type {
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
} from "./command-helpers.ts";
import { openCommitPick } from "./commit-pick.ts";
import { shortCommitHash } from "./commit-quick-pick-row.tsx";
import type { GitContinuablePausedOperationKind } from "./operation-runners.ts";
import {
  runAbortPausedOperation,
  runContinuePausedOperation,
} from "./operation-runners.ts";
import { pluginText } from "./plugin-text.ts";

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
    category: "git",
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

interface SequencerFollowUpCommand {
  readonly commandFallback: string;
  readonly commandId: string;
  readonly kind: GitContinuablePausedOperationKind;
}

function registerSequencerAbortAction(
  context: RendererPluginContext,
  command: SequencerFollowUpCommand,
  sortOrder: number
): () => void {
  return context.actions.register({
    category: "git",
    disabledReason: () => disabledReasonForActiveGit(context),
    enabled: () => enabledForActiveGit(context),
    handler: async () => {
      const title = commandTitle(
        context,
        command.commandId,
        command.commandFallback
      );
      const cwd = activeCwdOrMessage(context, title);
      if (!cwd) {
        return;
      }
      await runAbortPausedOperation(context, {
        cwd,
        kind: command.kind,
        title,
      });
    },
    id: command.commandId,
    metadata: {
      categoryKey: "git",
      group: "2_git",
      iconComponent: GitCommitHorizontal,
      sortOrder,
    },
    surfaces: ["command-palette"],
    title: () =>
      commandTitle(context, command.commandId, command.commandFallback),
  });
}

function registerSequencerContinueAction(
  context: RendererPluginContext,
  command: SequencerFollowUpCommand,
  sortOrder: number
): () => void {
  return context.actions.register({
    category: "git",
    disabledReason: () => disabledReasonForActiveGit(context),
    enabled: () => enabledForActiveGit(context),
    handler: async () => {
      const title = commandTitle(
        context,
        command.commandId,
        command.commandFallback
      );
      const cwd = activeCwdOrMessage(context, title);
      if (!cwd) {
        return;
      }
      await runContinuePausedOperation(context, {
        cwd,
        kind: command.kind,
        title,
      });
    },
    id: command.commandId,
    metadata: {
      categoryKey: "git",
      group: "2_git",
      iconComponent: GitCommitHorizontal,
      sortOrder,
    },
    surfaces: ["command-palette"],
    title: () =>
      commandTitle(context, command.commandId, command.commandFallback),
  });
}

export function registerCherryPickActions(
  context: RendererPluginContext
): () => void {
  const disposers = [
    registerSequencerRunAction(
      context,
      {
        commandFallback: "git: Cherry-pick Commit...",
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
        commandFallback: "git: Abort Cherry-pick",
        commandId: "pier.git.cherryPickAbort",
        kind: "cherry-picking",
      },
      22
    ),
    registerSequencerContinueAction(
      context,
      {
        commandFallback: "git: Continue Cherry-pick",
        commandId: "pier.git.cherryPickContinue",
        kind: "cherry-picking",
      },
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
        commandFallback: "git: Revert Commit...",
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
        commandFallback: "git: Abort Revert",
        commandId: "pier.git.revertAbort",
        kind: "reverting",
      },
      25
    ),
    registerSequencerContinueAction(
      context,
      {
        commandFallback: "git: Continue Revert",
        commandId: "pier.git.revertContinue",
        kind: "reverting",
      },
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
    category: "git",
    disabledReason: () => disabledReasonForActiveGit(context),
    enabled: () => enabledForActiveGit(context),
    handler: async () => {
      const title = commandTitle(
        context,
        "pier.git.undoLastCommit",
        "git: Undo Last Commit"
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
      commandTitle(context, "pier.git.undoLastCommit", "git: Undo Last Commit"),
  });
}
