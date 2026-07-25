import type { RendererPluginContext } from "@plugins/api/renderer.ts";
import { GitCompareArrows } from "lucide-react";
import {
  commandTitle,
  disabledReasonForActiveGit,
  enabledForActiveGit,
} from "./git-command-helpers.ts";
import { openGitChangesPanel } from "./git-review-open.ts";
import { unsupportedGitReason } from "./git-target.ts";

export function registerViewChangesAction(
  context: RendererPluginContext
): () => void {
  return context.actions.register({
    category: "Git",
    disabledReason: () => disabledReasonForActiveGit(context),
    enabled: () => enabledForActiveGit(context),
    handler: async () => {
      const panelContext = context.panels.getActiveContext();
      if (!panelContext?.gitRoot) {
        context.notifications.error(unsupportedGitReason(context));
        return;
      }
      await openGitChangesPanel({
        getGroupId: () => null,
        panelContext,
        pluginContext: context,
      });
    },
    id: "pier.git.viewChanges",
    metadata: {
      categoryKey: "git",
      group: "2_git",
      iconComponent: GitCompareArrows,
      sortOrder: 4,
    },
    surfaces: ["command-palette"],
    title: () =>
      commandTitle(context, "pier.git.viewChanges", "Git: View Changes"),
  });
}
