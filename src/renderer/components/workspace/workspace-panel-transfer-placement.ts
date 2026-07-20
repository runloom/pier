/**
 * Placement resolution for cross-window panel transfer.
 *
 * Contract: a drop must land exactly where the overlay Dockview showed
 * during dragover promised. Two resolution paths feed the same
 * `PanelTransferPlacement`:
 *
 * - HTML5 channel — `resolvePlacementFromDidDrop` consumes the state
 *   Dockview itself resolved for the drop (`position` / `panel` / `group`
 *   on the didDrop event are exactly the overlay it rendered); no geometry
 *   is re-derived.
 * - Bounds channel (Path B, source-window dragend; the target window gets
 *   no DOM drop event) — main converts the screen cursor to
 *   content-relative clientX/Y and the target renderer maps that point
 *   with `resolvePlacementFromClientPoint`, which mirrors Dockview's
 *   activation model: tab halves at 50%, content quadrants at 20% per axis
 *   (dockview-core `DEFAULT_ACTIVATION_SIZE`), evaluated left → right →
 *   top → bottom against the group's content element.
 */

import type { PanelTransferPlacement } from "@shared/contracts/panel-transfer.ts";
import type { DockviewApi } from "dockview-react";

/** Mirrors dockview-core Droptarget DEFAULT_ACTIVATION_SIZE (20% per axis). */
const SPLIT_ACTIVATION_PERCENT = 20;

interface GroupLike {
  element?: HTMLElement;
  id: string;
  panels: ReadonlyArray<{ id: string }>;
}

interface DidDropLike {
  group?: { id: string; panels: ReadonlyArray<{ id: string }> } | undefined;
  panel?: { id: string } | undefined;
  position?: string | undefined;
}

interface RectLike {
  bottom: number;
  height: number;
  left: number;
  right: number;
  top: number;
  width: number;
}

function pointInRect(x: number, y: number, rect: RectLike): boolean {
  return x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;
}

/**
 * The group's DOM container (`.dv-groupview`, header + content children).
 * Never read `group.model.element` — that getter throws
 * "dockview: not supported" in dockview-core 7, and optional chaining does
 * not guard against a throwing getter.
 */
function groupElement(group: GroupLike): HTMLElement | null {
  return group.element ?? null;
}

export function positionToDirection(
  position: string | undefined
): "left" | "right" | "above" | "below" | null {
  switch (position) {
    case "left":
      return "left";
    case "right":
      return "right";
    case "top":
    case "above":
      return "above";
    case "bottom":
    case "below":
      return "below";
    default:
      return null;
  }
}

/**
 * WYSIWYG mapping of a Dockview didDrop event. Dockview reports:
 * - content-quadrant drops as `position` left/right/top/bottom/center;
 * - header drops as `position: "center"` with `panel` set to the tab at
 *   the insertion index (undefined when inserting at the end) — the
 *   left/right tab-half → index conversion already happened in Dockview;
 * - root drop-target drops with no `group` (edge positions split the whole
 *   grid, center means an empty grid).
 */
export function resolvePlacementFromDidDrop(
  event: DidDropLike
): PanelTransferPlacement {
  const direction = positionToDirection(event.position);
  const group = event.group;
  if (!group) {
    return direction ? { direction, kind: "split" } : { kind: "root" };
  }
  if (direction) {
    return { direction, kind: "split", referenceGroupId: group.id };
  }
  const insertBefore = event.panel
    ? group.panels.findIndex((p) => p.id === event.panel?.id)
    : -1;
  return {
    groupId: group.id,
    index: insertBefore >= 0 ? insertBefore : group.panels.length,
    kind: "tab",
  };
}

/**
 * Tab-strip mapping for the bounds channel. Matches Dockview's per-tab
 * drop targets (zones left/right, activation 50%): pointer on the left
 * half inserts before that tab, right half after; strip void appends.
 */
function resolveTabStripPlacement(
  group: GroupLike,
  groupEl: HTMLElement,
  clientX: number,
  clientY: number
): PanelTransferPlacement | null {
  const tabsRoot =
    groupEl.querySelector<HTMLElement>(".dv-tabs-and-actions-container") ??
    groupEl.querySelector<HTMLElement>(".dv-tabs-container");
  if (!tabsRoot) {
    return null;
  }
  const tabsRect = tabsRoot.getBoundingClientRect();
  if (!pointInRect(clientX, clientY, tabsRect)) {
    return null;
  }
  const tabEls = Array.from(
    tabsRoot.querySelectorAll<HTMLElement>(".dv-tab")
  ).filter((el) => !el.classList.contains("dv-tab-action"));
  for (const [i, tabEl] of tabEls.entries()) {
    const rect = tabEl.getBoundingClientRect();
    if (!pointInRect(clientX, clientY, rect)) {
      continue;
    }
    const isLeftHalf = clientX - rect.left <= rect.width / 2;
    const index = isLeftHalf ? i : i + 1;
    return {
      groupId: group.id,
      index: Math.min(index, group.panels.length),
      kind: "tab",
    };
  }
  // Pointer on tab strip but not on a specific tab → append.
  return {
    groupId: group.id,
    index: group.panels.length,
    kind: "tab",
  };
}

/**
 * Content-area mapping for the bounds channel. Mirror of dockview-core
 * `calculateQuadrantAsPercentage` (threshold 20) over the group's content
 * element, in the same evaluation order, so the resolved placement equals
 * the overlay quadrant Dockview showed at that point.
 */
function resolveContentPlacement(
  group: GroupLike,
  groupEl: HTMLElement,
  clientX: number,
  clientY: number
): PanelTransferPlacement {
  const contentEl = groupEl.querySelector<HTMLElement>(
    ":scope > .dv-content-container"
  );
  const rect = (contentEl ?? groupEl).getBoundingClientRect();
  if (rect.width > 0 && rect.height > 0) {
    const xp = (100 * (clientX - rect.left)) / rect.width;
    const yp = (100 * (clientY - rect.top)) / rect.height;
    if (xp < SPLIT_ACTIVATION_PERCENT) {
      return { direction: "left", kind: "split", referenceGroupId: group.id };
    }
    if (xp > 100 - SPLIT_ACTIVATION_PERCENT) {
      return { direction: "right", kind: "split", referenceGroupId: group.id };
    }
    if (yp < SPLIT_ACTIVATION_PERCENT) {
      return { direction: "above", kind: "split", referenceGroupId: group.id };
    }
    if (yp > 100 - SPLIT_ACTIVATION_PERCENT) {
      return { direction: "below", kind: "split", referenceGroupId: group.id };
    }
  }
  return {
    groupId: group.id,
    index: group.panels.length,
    kind: "tab",
  };
}

/**
 * Map a client-space point to a Pier panel-transfer placement.
 * Empty dockview → root. Missed groups → root.
 */
export function resolvePlacementFromClientPoint(
  api: DockviewApi,
  clientX: number,
  clientY: number
): PanelTransferPlacement {
  const groups = (api.groups ?? []) as unknown as GroupLike[];
  if (groups.length === 0) {
    return { kind: "root" };
  }

  for (const group of groups) {
    const el = groupElement(group);
    if (!el) {
      continue;
    }
    const rect = el.getBoundingClientRect();
    if (!pointInRect(clientX, clientY, rect)) {
      continue;
    }
    const tabPlacement = resolveTabStripPlacement(group, el, clientX, clientY);
    if (tabPlacement) {
      return tabPlacement;
    }
    return resolveContentPlacement(group, el, clientX, clientY);
  }

  return { kind: "root" };
}
