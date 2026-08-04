import type { RendererPluginContext } from "@plugins/api/renderer.ts";
import type { PluginPanelInstanceOpenResult } from "@plugins/api/renderer-panels.ts";
import {
  type GitReviewScope,
  type GitReviewTarget,
  gitReviewScopeSchema,
} from "@shared/contracts/git/review.ts";
import type { PanelContext } from "@shared/contracts/panel.ts";
import { GIT_CHANGES_PANEL_ID } from "../../manifest.ts";
import { gitChangesPanelTitle } from "../changes-tab-title.ts";
import { pluginText } from "../plugin-text.ts";

function reviewTargetKey(target: GitReviewTarget): string {
  if (target.kind === "commit") {
    return `commit:${target.oid}`;
  }
  if (target.kind === "branch") {
    return `branch:${target.ref}`;
  }
  return "uncommitted";
}

function sameReviewTarget(
  left: GitReviewTarget,
  right: GitReviewTarget
): boolean {
  return reviewTargetKey(left) === reviewTargetKey(right);
}

function sameReviewSource(input: unknown, expected: GitReviewScope): boolean {
  const parsed = gitReviewScopeSchema.safeParse(input);
  return (
    parsed.success &&
    parsed.data.contextId === expected.contextId &&
    parsed.data.gitRootPath === expected.gitRootPath &&
    sameReviewTarget(parsed.data.target, expected.target)
  );
}

export async function openGitChangesPanel(input: {
  getGroupId: () => string | null;
  panelContext: PanelContext;
  pluginContext: RendererPluginContext;
  target?: GitReviewTarget;
}): Promise<void> {
  const gitRootPath =
    input.panelContext.gitRoot ??
    input.panelContext.worktreeRoot ??
    input.panelContext.projectRootPath;
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
    target: input.target ?? { kind: "uncommitted" },
  };
  try {
    const preferredGroupId = input.getGroupId();
    const instances =
      input.pluginContext.panels.listInstances(GIT_CHANGES_PANEL_ID);
    const matches = instances.filter((instance) =>
      sameReviewSource(instance.params?.source, source)
    );
    // Status bar / command palette "open Review" is show-or-focus, not create
    // another copy. Prefer the caller's group when it already has a match;
    // otherwise focus any open Review for the same source (including other windows).
    const existing =
      (preferredGroupId
        ? matches.find((instance) => instance.groupId === preferredGroupId)
        : undefined) ?? matches[0];
    const title = gitChangesPanelTitle(source);
    if (existing) {
      const focusResult = input.pluginContext.panels.openInstance({
        componentId: GIT_CHANGES_PANEL_ID,
        context: input.panelContext,
        instanceId: existing.id,
        params: { source },
        ...(existing.groupId ? { targetGroupId: existing.groupId } : {}),
        title,
      });
      if (focusResult.kind !== "targetGroupMissing") {
        return;
      }
      // Listed group vanished between list and open — fall through.
    }

    // Local miss (or stale group): any window with the same review source.
    const remote = (
      await input.pluginContext.panels.listInstancesGlobal(GIT_CHANGES_PANEL_ID)
    ).find((instance) => sameReviewSource(instance.params?.source, source));
    if (remote) {
      const remoteFocus = await input.pluginContext.panels.focusInstance({
        componentId: GIT_CHANGES_PANEL_ID,
        instanceId: remote.id,
        windowId: remote.windowId,
      });
      if (remoteFocus.kind === "focused") {
        return;
      }
      if (remoteFocus.kind === "error") {
        await input.pluginContext.dialogs.alert({
          body: remoteFocus.message,
          title: pluginText(
            input.pluginContext,
            "reviewOpenFailed",
            "Failed to open changes"
          ),
        });
        return;
      }
      // not_found — panel closed between list and focus; create locally.
    }

    openInCurrentGroup({
      getGroupId: input.getGroupId,
      open: (targetGroupId) => {
        // Refresh: focus-path ghosts must not poison collision checks.
        const liveInstances =
          input.pluginContext.panels.listInstances(GIT_CHANGES_PANEL_ID);
        const groupKey = targetGroupId ?? "active";
        const canonicalId = `${GIT_CHANGES_PANEL_ID}:${groupKey}:${source.contextId}:${reviewTargetKey(source.target)}`;
        const instanceId = liveInstances.some(
          (instance) => instance.id === canonicalId
        )
          ? `${canonicalId}:${crypto.randomUUID()}`
          : canonicalId;
        return input.pluginContext.panels.openInstance({
          componentId: GIT_CHANGES_PANEL_ID,
          context: input.panelContext,
          instanceId,
          params: { source },
          ...(targetGroupId ? { targetGroupId } : {}),
          title,
        });
      },
      pluginContext: input.pluginContext,
    });
  } catch (error) {
    input.pluginContext.dialogs
      .alert({
        body: error instanceof Error ? error.message : String(error),
        title: pluginText(
          input.pluginContext,
          "reviewOpenFailed",
          "Failed to open changes"
        ),
      })
      .catch(() => undefined);
  }
}

function openInCurrentGroup(input: {
  getGroupId: () => string | null;
  open: (groupId: null | string) => PluginPanelInstanceOpenResult;
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
  // 命令面板等无 status-item getGroupId 时：交给宿主 active group 落点。
  if (input.open(null).kind === "opened") {
    return;
  }
  input.pluginContext.notifications.error(
    pluginText(
      input.pluginContext,
      "reviewTargetGroupMissing",
      "The current panel group is no longer available."
    )
  );
}
