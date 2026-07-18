import type { DockviewApi } from "dockview-react";
import { pickFocusTarget } from "@/lib/workspace/focus-target.ts";
import { activateWorkspacePanel } from "@/lib/workspace/panel-activation.ts";

/**
 * = pierTheme.gap (4) + 1. 改 gap 必须同步此常量.
 * 容忍像素让相邻 group 的边界比较不被 gap 卡掉.
 */
const FOCUS_TOL_PX = 5;

function getGroupElement(g: unknown): HTMLElement | null {
  const el = (g as { element?: HTMLElement } | null)?.element;
  return el instanceof HTMLElement ? el : null;
}

function groupForPanel(
  api: DockviewApi,
  panelId: string | undefined
): DockviewApi["groups"][number] | null {
  if (!panelId) {
    return null;
  }
  for (const group of api.groups) {
    if (group.panels.some((panel) => panel.id === panelId)) {
      return group;
    }
  }
  return null;
}

export function focusWorkspaceGroup(
  api: DockviewApi,
  direction: "right" | "down" | "left" | "up",
  sourcePanelId?: string
): void {
  if (api.groups.length < 2) {
    return;
  }
  const sourceGroup =
    groupForPanel(api, sourcePanelId) ?? api.activeGroup ?? null;
  if (!sourceGroup) {
    return;
  }

  const sourceEl = getGroupElement(sourceGroup);
  if (!sourceEl) {
    return;
  }
  const sourceRect = sourceEl.getBoundingClientRect();

  const candidates = api.groups.map((g) => ({
    id: g.id,
    isActive: g.id === sourceGroup.id,
    rect: getGroupElement(g)?.getBoundingClientRect() ?? null,
  }));
  const targetIdx = pickFocusTarget(
    sourceRect,
    candidates,
    direction,
    FOCUS_TOL_PX
  );
  if (targetIdx === null) {
    return;
  }

  const targetGroup = api.groups[targetIdx];
  const targetPanel = targetGroup?.activePanel ?? targetGroup?.panels[0];
  if (!targetPanel) {
    return;
  }

  activateWorkspacePanel(api, targetPanel.id, { reveal: "always" });
}
