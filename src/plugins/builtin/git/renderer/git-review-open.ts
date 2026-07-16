import type { RendererPluginContext } from "@plugins/api/renderer.ts";
import type { PluginPanelInstanceOpenResult } from "@plugins/api/renderer-panels.ts";
import {
  type GitReviewScope,
  gitReviewScopeSchema,
} from "@shared/contracts/git-review.ts";
import type { PanelContext } from "@shared/contracts/panel.ts";
import { GIT_CHANGES_PANEL_ID } from "../manifest.ts";
import { pluginText } from "./git-plugin-text.ts";

export function openGitChangesPanel(input: {
  getGroupId: () => string | null;
  panelContext: PanelContext;
  pluginContext: RendererPluginContext;
}): void {
  const gitRootPath = input.panelContext.gitRoot;
  if (!gitRootPath) {
    input.pluginContext.notifications.error(
      pluginText(
        input.pluginContext,
        "reviewTargetGroupMissing",
        "The current panel group is no longer available."
      )
    );
    return;
  }
  const source: GitReviewScope = {
    contextId: input.panelContext.contextId,
    gitRootPath,
  };
  try {
    openInCurrentGroup({
      getGroupId: input.getGroupId,
      open: (targetGroupId) => {
        const instances =
          input.pluginContext.panels.listInstances(GIT_CHANGES_PANEL_ID);
        const existingInTarget = instances.find(
          (instance) =>
            instance.groupId === targetGroupId &&
            sameReviewSource(instance.params?.source, source)
        );
        const canonicalId = `${GIT_CHANGES_PANEL_ID}:${targetGroupId}:${source.contextId}`;
        const instanceId =
          existingInTarget?.id ??
          (instances.some((instance) => instance.id === canonicalId)
            ? `${canonicalId}:${crypto.randomUUID()}`
            : canonicalId);
        return input.pluginContext.panels.openInstance({
          componentId: GIT_CHANGES_PANEL_ID,
          context: input.panelContext,
          instanceId,
          params: { source },
          targetGroupId,
          title: pluginText(
            input.pluginContext,
            "reviewChangesTitle",
            "Changes"
          ),
        });
      },
      pluginContext: input.pluginContext,
    });
  } catch (error) {
    input.pluginContext.dialogs
      .alert({
        body: error instanceof Error ? error.message : String(error),
        size: "default",
        title: pluginText(
          input.pluginContext,
          "reviewOpenFailed",
          "Failed to open changes"
        ),
      })
      .catch(() => undefined);
  }
}

function sameReviewSource(input: unknown, expected: GitReviewScope): boolean {
  const parsed = gitReviewScopeSchema.safeParse(input);
  return (
    parsed.success &&
    parsed.data.contextId === expected.contextId &&
    parsed.data.gitRootPath === expected.gitRootPath
  );
}

function openInCurrentGroup(input: {
  getGroupId: () => string | null;
  open: (groupId: string) => PluginPanelInstanceOpenResult;
  pluginContext: RendererPluginContext;
}): void {
  const groupId = input.getGroupId();
  if (groupId) {
    const result = input.open(groupId);
    if (result.kind !== "targetGroupMissing") {
      return;
    }
    const retryGroupId = input.getGroupId();
    if (
      retryGroupId &&
      retryGroupId !== groupId &&
      input.open(retryGroupId).kind !== "targetGroupMissing"
    ) {
      return;
    }
  }
  input.pluginContext.notifications.error(
    pluginText(
      input.pluginContext,
      "reviewTargetGroupMissing",
      "The current panel group is no longer available."
    )
  );
}
