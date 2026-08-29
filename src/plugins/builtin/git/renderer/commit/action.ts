import type { RendererPluginContext } from "@plugins/api/renderer.ts";
import type { GitStatus } from "@shared/contracts/git.ts";
import { GitCommitHorizontal } from "lucide-react";
import {
  activeCwdOrMessage,
  commandTitle,
  disabledReasonForActiveGit,
  enabledForActiveGit,
  showError,
} from "../command-helpers.ts";
import { pluginText } from "../plugin-text.ts";
import { openGitCommitOverlay } from "./overlay.tsx";
import { isWorkingTreeEmpty } from "./paths.ts";

export async function runGitCommitCommand(
  context: RendererPluginContext
): Promise<void> {
  const title = commandTitle(context, "pier.git.commit", "git: Commit");
  const cwd = activeCwdOrMessage(context, title);
  if (!cwd) {
    return;
  }
  let status: GitStatus;
  try {
    status = await context.git.getStatus(cwd);
  } catch (error) {
    await showError(context, title, error);
    return;
  }
  if (status.repoState.kind !== "clean") {
    await context.dialogs.alert({
      body: pluginText(
        context,
        "gitCommitPaused",
        "Continue or abort the current git operation from the status bar first."
      ),
      title,
    });
    return;
  }
  if (isWorkingTreeEmpty(status)) {
    await context.dialogs.alert({
      body: pluginText(
        context,
        "gitCommitNothing",
        "Nothing to commit. Change a file first."
      ),
      title,
    });
    return;
  }
  openGitCommitOverlay(context, { cwd, status });
}

export function registerCommitAction(
  context: RendererPluginContext
): () => void {
  return context.actions.register({
    category: "git",
    disabledReason: () => disabledReasonForActiveGit(context),
    enabled: () => enabledForActiveGit(context),
    handler: () => runGitCommitCommand(context),
    id: "pier.git.commit",
    metadata: {
      categoryKey: "git",
      group: "2_git",
      iconComponent: GitCommitHorizontal,
      sortOrder: 19,
    },
    surfaces: ["command-palette"],
    title: () => commandTitle(context, "pier.git.commit", "git: Commit"),
  });
}
