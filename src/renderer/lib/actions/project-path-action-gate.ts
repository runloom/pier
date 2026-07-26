/**
 * 路径依赖操作门控：当前 panel 必须自持项目路径，否则 create-menu / 命令面板禁用，
 * 快捷键 toast 提示（见 use-keybindings）。
 */

import i18next from "i18next";
import type { ActionInvocation } from "@/lib/actions/types.ts";
import { useWorkspaceStore } from "@/stores/workspace.store.ts";
import { hasProjectPathAnchor } from "@/stores/workspace-panel-helpers.ts";

export function invocationHasProjectPath(
  invocation?: ActionInvocation
): boolean {
  return hasProjectPathAnchor({
    api: useWorkspaceStore.getState().api,
    sourcePanelContext: invocation?.sourcePanelContext,
    sourcePanelGroupId: invocation?.sourcePanelGroupId,
    sourcePanelId: invocation?.sourcePanelId,
  });
}

export function projectPathRequiredReason(): string {
  return i18next.t("commandPalette.run.noTaskContextDetail");
}

export function projectPathActionEnabled(
  invocation?: ActionInvocation
): boolean {
  return (
    useWorkspaceStore.getState().api != null &&
    invocationHasProjectPath(invocation)
  );
}

export function projectPathActionDisabledReason(
  invocation?: ActionInvocation
): string | null {
  if (projectPathActionEnabled(invocation)) {
    return null;
  }
  return projectPathRequiredReason();
}
