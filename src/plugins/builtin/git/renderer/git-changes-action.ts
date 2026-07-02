import type { RendererPluginContext } from "@plugins/api/renderer.ts";
import { GitBranch } from "lucide-react";

export function registerGitChangesAction(
  context: RendererPluginContext
): () => void {
  return context.actions.register({
    category: "Git",
    handler: () => {
      const sourceContext = context.panels.getActiveContext();
      context.panels.open(
        "pier.git.changes",
        sourceContext ? { context: sourceContext } : undefined
      );
    },
    id: "pier.git.changes.open",
    metadata: {
      categoryKey: "git",
      group: "1_worktree",
      iconComponent: GitBranch,
      sortOrder: 4,
    },
    surfaces: ["command-palette"],
    title: () =>
      context.i18n.commandTitle("pier.git.changes.open", "Git: Open Changes"),
  });
}
