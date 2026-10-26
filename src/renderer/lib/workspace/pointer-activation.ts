import type { DockviewApi } from "dockview-react";

/**
 * Left pointerdown in a group's content activates that group's active panel.
 *
 * Dockview normally activates a group through DOM focus: clicking content
 * focuses `.dv-content-container` (tabindex=-1). Controls that call
 * `preventDefault()` on pointerdown suppress that focus move, leaving
 * `activePanel` on the previous group — Cmd+W would then close the wrong tab.
 *
 * The tab strip / header is excluded: closing an inactive tab must keep the
 * current active panel (VS Code semantics, also relied on by the tab × and
 * context-menu close paths).
 */
const GROUP_SELECTOR = ".dv-groupview";
const GROUP_HEADER_SELECTOR = ".dv-tabs-and-actions-container";

export function activatePanelFromContentPointerDown(
  api: Pick<DockviewApi, "groups">,
  target: EventTarget | null
): boolean {
  if (!(target instanceof Element)) {
    return false;
  }
  if (target.closest(GROUP_HEADER_SELECTOR)) {
    return false;
  }
  const groupElement = target.closest(GROUP_SELECTOR);
  if (!groupElement) {
    return false;
  }
  const group = api.groups?.find(
    (candidate) => candidate.element === groupElement
  );
  if (!group || group.api.isActive) {
    return false;
  }
  const panel = group.activePanel;
  if (!panel) {
    return false;
  }
  panel.api.setActive();
  return true;
}
