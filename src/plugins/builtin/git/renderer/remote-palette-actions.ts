import type { RendererPluginContext } from "@plugins/api/renderer.ts";
import { ArrowDownToLine, ArrowUpFromLine, RefreshCw } from "lucide-react";
import {
  commandTitle,
  disabledReasonForActiveGit,
  enabledForActiveGit,
  showError,
} from "./command-helpers.ts";
import {
  type GitRemoteSyncActionId,
  runRemoteSyncAction,
} from "./status-dropdown-actions.ts";
import { activeGitTarget } from "./target.ts";

function registerRemotePaletteAction(
  context: RendererPluginContext,
  options: {
    actionId: GitRemoteSyncActionId;
    commandId: string;
    fallbackTitle: string;
    icon: typeof ArrowDownToLine;
    sortOrder: number;
  }
): () => void {
  return context.actions.register({
    category: "Git",
    disabledReason: () => disabledReasonForActiveGit(context),
    enabled: () => enabledForActiveGit(context),
    handler: async () => {
      const title = commandTitle(
        context,
        options.commandId,
        options.fallbackTitle
      );
      const target = activeGitTarget(context);
      if (!target.enabled) {
        return;
      }
      try {
        await runRemoteSyncAction(context, options.actionId, target.target.cwd);
      } catch (err) {
        await showError(context, title, err);
      }
    },
    id: options.commandId,
    metadata: {
      categoryKey: "git",
      group: "2_git",
      iconComponent: options.icon,
      sortOrder: options.sortOrder,
    },
    surfaces: ["command-palette"],
    title: () =>
      commandTitle(context, options.commandId, options.fallbackTitle),
  });
}

export function registerGitRemotePaletteActions(
  context: RendererPluginContext
): () => void {
  const disposers = [
    registerRemotePaletteAction(context, {
      actionId: "pull",
      commandId: "pier.git.pull",
      fallbackTitle: "Git: Pull",
      icon: ArrowDownToLine,
      sortOrder: 5,
    }),
    registerRemotePaletteAction(context, {
      actionId: "push",
      commandId: "pier.git.push",
      fallbackTitle: "Git: Push",
      icon: ArrowUpFromLine,
      sortOrder: 6,
    }),
    registerRemotePaletteAction(context, {
      actionId: "syncChanges",
      commandId: "pier.git.sync",
      fallbackTitle: "Git: Sync",
      icon: RefreshCw,
      sortOrder: 7,
    }),
  ];
  return () => {
    for (const dispose of disposers) {
      dispose();
    }
  };
}
