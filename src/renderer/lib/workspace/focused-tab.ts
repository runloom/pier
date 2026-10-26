/**
 * Tab-strip focus probe for close semantics.
 *
 * Cmd+W is "close the thing that has focus". Dockview's `activePanel` only
 * tracks the selected tab inside a group; keyboard / assistive focus can sit
 * on an inactive tab without changing it (WAI-ARIA manual activation).
 *
 * Only trust `document.activeElement` while the web document actually owns
 * keyboard focus. When a native terminal holds firstResponder the document is
 * unfocused and `activeElement` can still point at an old tab or content node.
 */

const TAB_PANEL_ID_ATTRIBUTE = "data-panel-tab-id";

function tabElementFor(active: Element | null): Element | null {
  if (!(active instanceof Element)) {
    return null;
  }
  return (
    active.closest(`[${TAB_PANEL_ID_ATTRIBUTE}]`) ??
    active.closest(".dv-tab")?.querySelector(`[${TAB_PANEL_ID_ATTRIBUTE}]`) ??
    null
  );
}

export function focusedTabPanelId(doc: Document = document): string | null {
  if (!doc.hasFocus()) {
    return null;
  }
  const panelId = tabElementFor(doc.activeElement)?.getAttribute(
    TAB_PANEL_ID_ATTRIBUTE
  );
  return panelId && panelId.length > 0 ? panelId : null;
}

/**
 * Drop tab-strip focus that belongs to a group other than `groupElement`.
 *
 * Dockview can change the active group without moving DOM focus (focus-right
 * command, programmatic setActive, native terminal focus intent). The old tab
 * would otherwise remain in `document.activeElement` and outrank the panel the
 * user just switched to when Cmd+W resolves its close target.
 */
export function releaseTabFocusOutsideGroup(
  groupElement: Element | null | undefined
): void {
  if (!(groupElement instanceof Element)) {
    return;
  }
  const focused = groupElement.ownerDocument.activeElement;
  if (!(focused instanceof HTMLElement)) {
    return;
  }
  const tab = tabElementFor(focused);
  if (!tab) {
    return;
  }
  if (tab.closest(".dv-groupview") !== groupElement) {
    focused.blur();
  }
}
