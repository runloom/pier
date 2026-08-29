import type { RendererPluginContext } from "@plugins/api/renderer.ts";
import {
  registerMergeAction,
  registerRebaseAction,
  registerSwitchBranchAction,
} from "./branch-actions.ts";
import { registerCommitAction } from "./commit/action.ts";
import {
  registerMergeAbortAction,
  registerRebaseAbortAction,
  registerRebaseContinueAction,
} from "./merge-rebase-actions.ts";
import { registerGitRemotePaletteActions } from "./remote-palette-actions.ts";
import {
  registerCherryPickActions,
  registerRevertActions,
  registerUndoCommitAction,
} from "./sequencer-actions.ts";
import {
  registerStashAction,
  registerStashApplyAction,
  registerStashDropAction,
  registerStashIncludeUntrackedAction,
  registerStashPopAction,
} from "./stash-actions.ts";
import { registerViewChangesAction } from "./view-changes-action.ts";

export function registerGitActions(context: RendererPluginContext): () => void {
  const disposers = [
    registerViewChangesAction(context),
    registerGitRemotePaletteActions(context),
    registerMergeAction(context),
    registerSwitchBranchAction(context),
    registerMergeAbortAction(context),
    registerStashAction(context),
    registerStashIncludeUntrackedAction(context),
    registerStashPopAction(context),
    registerStashApplyAction(context),
    registerStashDropAction(context),
    registerRebaseAction(context),
    registerRebaseAbortAction(context),
    registerRebaseContinueAction(context),
    registerCherryPickActions(context),
    registerRevertActions(context),
    registerCommitAction(context),
    registerUndoCommitAction(context),
  ];
  return () => {
    for (const dispose of disposers) {
      dispose();
    }
  };
}
