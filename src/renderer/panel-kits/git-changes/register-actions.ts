import { GitBranch } from "lucide-react";
import { registerActionContributions } from "@/lib/actions/contribution-runtime.ts";
import type { ActionContribution } from "@/lib/actions/contribution-types.ts";
import { rendererActionContributionRuntime } from "@/lib/actions/renderer-action-runtime.ts";
import { openGitChangesPanel } from "./open-git-changes.ts";

export const GIT_CHANGES_ACTION_CONTRIBUTIONS: readonly ActionContribution[] = [
  {
    categoryKey: "git",
    group: "1_new",
    handler: () => {
      openGitChangesPanel();
    },
    iconComponent: GitBranch,
    id: "pier.git.changes.open",
    sortOrder: 1,
    surfaces: ["command-palette"],
    titleKey: "commandPalette.action.openGitChanges",
  },
];

export function registerGitChangesActions(): () => void {
  const disposers = registerActionContributions(
    GIT_CHANGES_ACTION_CONTRIBUTIONS,
    rendererActionContributionRuntime
  );
  return () => {
    for (const dispose of disposers) {
      dispose();
    }
  };
}
