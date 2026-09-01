/**
 * Visual tear-off of a source tab while Path B creates a new window.
 *
 * HTML5 dragend destroys the OS ghost immediately. Hide the Dockview tab
 * (and its web content) as soon as the cursor leaves Pier windows so the
 * tab cannot snap back onto the strip, then keep it hidden until
 * releaseSource or a cancelled claim.
 *
 * Dockview may recreate `.dv-tab` on dragend; html-scoped CSS keeps the
 * replacement hidden even if the data attribute on the old node is gone.
 */

import type { DockviewApi } from "dockview-react";

export const PANEL_TRANSFER_IN_TRANSIT_ATTR =
  "data-pier-panel-transfer-in-transit";

const TEAR_OFF_STYLE_ID = "pier-panel-transfer-tear-off-style";

let inTransitPanelId: string | null = null;
let holdForClaim = false;
let hiddenContent: HTMLElement | null = null;
let keepAliveTimer: ReturnType<typeof setTimeout> | null = null;
let keepAliveFrame = 0;

export function isDragReleaseOutsideThisWindow(event: {
  clientX: number;
  clientY: number;
  screenX?: number;
  screenY?: number;
}): boolean {
  const { clientX, clientY } = event;
  if (
    clientX < 0 ||
    clientY < 0 ||
    clientX > window.innerWidth ||
    clientY > window.innerHeight
  ) {
    return true;
  }
  const screenX = event.screenX;
  const screenY = event.screenY;
  if (typeof screenX !== "number" || typeof screenY !== "number") {
    return false;
  }
  const left = window.screenX;
  const top = window.screenY;
  const width = window.outerWidth > 0 ? window.outerWidth : window.innerWidth;
  const height =
    window.outerHeight > 0 ? window.outerHeight : window.innerHeight;
  return (
    screenX < left ||
    screenY < top ||
    screenX > left + width ||
    screenY > top + height
  );
}

function tabElementFor(panelId: string): HTMLElement | null {
  const inner = document.querySelector(`[data-panel-tab-id="${panelId}"]`);
  if (!(inner instanceof HTMLElement)) {
    return null;
  }
  return inner.closest(".dv-tab");
}

function contentElementFor(
  api: DockviewApi | null,
  panelId: string
): HTMLElement | null {
  const panel = api?.getPanel?.(panelId);
  const element = panel?.view?.content?.element;
  return element instanceof HTMLElement ? element : null;
}

function stylesheetFor(panelId: string): string {
  const escaped = CSS.escape(panelId);
  return `html[${PANEL_TRANSFER_IN_TRANSIT_ATTR}="${escaped}"] .dv-tab:has([data-panel-tab-id="${escaped}"]){display:none!important}`;
}

function syncTearOffStyle(panelId: string | null): void {
  const root = document.documentElement;
  if (!panelId) {
    root.removeAttribute(PANEL_TRANSFER_IN_TRANSIT_ATTR);
    document.getElementById(TEAR_OFF_STYLE_ID)?.remove();
    return;
  }
  root.setAttribute(PANEL_TRANSFER_IN_TRANSIT_ATTR, panelId);
  let style = document.getElementById(TEAR_OFF_STYLE_ID);
  if (!(style instanceof HTMLStyleElement)) {
    style = document.createElement("style");
    style.id = TEAR_OFF_STYLE_ID;
    document.head.append(style);
  }
  style.textContent = stylesheetFor(panelId);
}

function stopKeepAlive(): void {
  if (keepAliveTimer !== null) {
    clearTimeout(keepAliveTimer);
    keepAliveTimer = null;
  }
  if (keepAliveFrame !== 0) {
    cancelAnimationFrame(keepAliveFrame);
    keepAliveFrame = 0;
  }
}

function restoreContent(): void {
  if (!hiddenContent) {
    return;
  }
  hiddenContent.style.removeProperty("visibility");
  hiddenContent.style.removeProperty("pointer-events");
  hiddenContent = null;
}

function restoreTab(panelId: string): void {
  const tab = tabElementFor(panelId);
  tab?.removeAttribute(PANEL_TRANSFER_IN_TRANSIT_ATTR);
}

function applyHide(panelId: string, api: DockviewApi | null): void {
  syncTearOffStyle(panelId);
  const tab = tabElementFor(panelId);
  tab?.setAttribute(PANEL_TRANSFER_IN_TRANSIT_ATTR, "");
  restoreContent();
  const content = contentElementFor(api, panelId);
  if (content) {
    content.style.visibility = "hidden";
    content.style.pointerEvents = "none";
    hiddenContent = content;
  }
}

function startKeepAlive(panelId: string, api: DockviewApi | null): void {
  stopKeepAlive();
  const pulse = (): void => {
    if (inTransitPanelId !== panelId) {
      return;
    }
    applyHide(panelId, api);
  };
  keepAliveFrame = requestAnimationFrame(() => {
    pulse();
    keepAliveFrame = requestAnimationFrame(pulse);
  });
  keepAliveTimer = setTimeout(pulse, 48);
}

export function hidePanelTransferTearOff(
  panelId: string,
  api: DockviewApi | null
): void {
  if (inTransitPanelId && inTransitPanelId !== panelId) {
    restoreTab(inTransitPanelId);
    restoreContent();
  }
  inTransitPanelId = panelId;
  applyHide(panelId, api);
  startKeepAlive(panelId, api);
}

export function revealPanelTransferTearOff(): void {
  if (holdForClaim) {
    return;
  }
  stopKeepAlive();
  if (inTransitPanelId) {
    restoreTab(inTransitPanelId);
  }
  restoreContent();
  inTransitPanelId = null;
  syncTearOffStyle(null);
}

/** dragend while the tab is already in transit: ignore overlay `clear`. */
export function armPanelTransferTearOffClaim(): void {
  if (inTransitPanelId) {
    holdForClaim = true;
  }
}

export function settlePanelTransferTearOffClaim(keepHidden: boolean): void {
  holdForClaim = false;
  if (keepHidden) {
    return;
  }
  revealPanelTransferTearOff();
}

export function clearPanelTransferTearOff(): void {
  holdForClaim = false;
  stopKeepAlive();
  if (inTransitPanelId) {
    restoreTab(inTransitPanelId);
  }
  restoreContent();
  inTransitPanelId = null;
  syncTearOffStyle(null);
}

export function panelTransferTearOffPanelIdForTests(): string | null {
  return inTransitPanelId;
}

export function panelTransferTearOffHoldForTests(): boolean {
  return holdForClaim;
}

export function resetPanelTransferTearOffForTests(): void {
  clearPanelTransferTearOff();
}
