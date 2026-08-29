/**
 * Group-local tab insert index (symmetric with panel-close-successor).
 *
 * Related opens (new terminal, file, plugin instance) sit after the current
 * tab. Blank Welcome from addTab goes to the end, next to the header +.
 * Callers that cannot see `group.panels` omit `index` and dockview appends.
 */

export type PanelInsertIntent = "after-active" | "end";

export interface PanelInsertPanelLike {
  id: string;
}

export interface PanelInsertGroupLike {
  activePanel?: PanelInsertPanelLike | null | undefined;
  panels?: readonly PanelInsertPanelLike[] | undefined;
}

export function resolvePanelInsertIndex(
  group: PanelInsertGroupLike | null | undefined,
  intent: PanelInsertIntent = "after-active",
  afterPanelId?: string | null
): number | undefined {
  const panels = group?.panels;
  if (!panels) {
    return;
  }
  if (intent === "end") {
    return panels.length;
  }
  const targetId = afterPanelId ?? group?.activePanel?.id ?? null;
  if (!targetId) {
    return panels.length;
  }
  const index = panels.findIndex((panel) => panel.id === targetId);
  return index < 0 ? panels.length : index + 1;
}

export function panelInsertIndexFields(
  group: PanelInsertGroupLike | null | undefined,
  intent: PanelInsertIntent = "after-active",
  afterPanelId?: string | null
): { index: number } | Record<string, never> {
  const index = resolvePanelInsertIndex(group, intent, afterPanelId);
  return index === undefined ? {} : { index };
}

export function withinGroupPosition<T extends PanelInsertGroupLike>(
  group: T,
  intent: PanelInsertIntent = "after-active",
  afterPanelId?: string | null
): {
  direction: "within";
  index?: number;
  referenceGroup: T;
} {
  return {
    direction: "within",
    referenceGroup: group,
    ...panelInsertIndexFields(group, intent, afterPanelId),
  };
}

export function withinPanelPosition(
  panelId: string,
  group: PanelInsertGroupLike | null | undefined,
  afterPanelId: string = panelId
): {
  direction: "within";
  index?: number;
  referencePanel: string;
} {
  return {
    direction: "within",
    referencePanel: panelId,
    ...panelInsertIndexFields(group, "after-active", afterPanelId),
  };
}
