import type { RendererPluginContext } from "@plugins/api/renderer.ts";
import {
  registerMergeAction,
  registerRebaseAction,
} from "./git-branch-actions.ts";
import {
  registerMergeAbortAction,
  registerRebaseAbortAction,
  registerRebaseContinueAction,
  registerUndoCommitAction,
} from "./git-sequencer-actions.ts";
import {
  registerStashAction,
  registerStashApplyAction,
  registerStashDropAction,
  registerStashIncludeUntrackedAction,
  registerStashPopAction,
} from "./git-stash-actions.ts";

export function registerGitActions(context: RendererPluginContext): () => void {
  const disposers = [
    registerMergeAction(context),
    registerMergeAbortAction(context),
    registerStashAction(context),
    registerStashIncludeUntrackedAction(context),
    registerStashPopAction(context),
    registerStashApplyAction(context),
    registerStashDropAction(context),
    registerRebaseAction(context),
    registerRebaseAbortAction(context),
    registerRebaseContinueAction(context),
    registerUndoCommitAction(context),
  ];
  return () => {
    for (const dispose of disposers) {
      dispose();
    }
  };
}
