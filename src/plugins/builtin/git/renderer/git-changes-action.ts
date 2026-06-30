import type { RendererPluginContext } from "@plugins/api/renderer.ts";
import { GitBranch } from "lucide-react";

export function registerGitChangesAction(
  context: RendererPluginContext
): () => void {
  return context.actions.register({
    category: "Git",
    handler: () => context.panels.open("pier.git.changes"),
    id: "pier.git.changes.open",
    metadata: {
      aliases: () => [
        "git changes",
        "open changes",
        "变更",
        "打开变更面板",
        "biangeng",
        context.i18n.commandTitle("pier.git.changes.open", "Git: Open Changes"),
      ],
      categoryKey: "git",
      group: "1_new",
      iconComponent: GitBranch,
      sortOrder: 4,
    },
    surfaces: ["command-palette"],
    title: () =>
      context.i18n.commandTitle("pier.git.changes.open", "Git: Open Changes"),
  });
}
