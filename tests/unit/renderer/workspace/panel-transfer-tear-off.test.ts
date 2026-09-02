import { afterEach, describe, expect, it } from "vitest";
import {
  armPanelTransferTearOffClaim,
  clearPanelTransferTearOff,
  hidePanelTransferTearOff,
  isDragReleaseOutsideThisWindow,
  PANEL_TRANSFER_IN_TRANSIT_ATTR,
  panelTransferTearOffHoldForTests,
  panelTransferTearOffPanelIdForTests,
  resetPanelTransferTearOffForTests,
  revealPanelTransferTearOff,
  settlePanelTransferTearOffClaim,
} from "@/components/workspace/transfer/tear-off.ts";

function mountTab(panelId: string): {
  content: HTMLElement;
  tab: HTMLElement;
} {
  const tab = document.createElement("div");
  tab.className = "dv-tab";
  const inner = document.createElement("div");
  inner.dataset.panelTabId = panelId;
  tab.append(inner);
  const content = document.createElement("div");
  document.body.append(tab, content);
  return { content, tab };
}

describe("panel transfer tear-off", () => {
  afterEach(() => {
    resetPanelTransferTearOffForTests();
    document.body.replaceChildren();
  });

  it("hides the source tab and content while in transit", () => {
    const { tab, content } = mountTab("panel-1");
    hidePanelTransferTearOff("panel-1", {
      getPanel: () => ({ view: { content: { element: content } } }),
    } as never);
    expect(tab.hasAttribute(PANEL_TRANSFER_IN_TRANSIT_ATTR)).toBe(true);
    expect(content.style.visibility).toBe("hidden");
    expect(panelTransferTearOffPanelIdForTests()).toBe("panel-1");
    expect(
      document.documentElement.getAttribute(PANEL_TRANSFER_IN_TRANSIT_ATTR)
    ).toBe("panel-1");
    expect(
      document.getElementById("pier-panel-transfer-tear-off-style")?.textContent
    ).toContain("panel-1");
  });

  it("keeps a recreated tab hidden via html-scoped CSS", () => {
    const first = mountTab("panel-1");
    hidePanelTransferTearOff("panel-1", { getPanel: () => undefined } as never);
    first.tab.remove();
    const second = mountTab("panel-1");
    expect(second.tab.hasAttribute(PANEL_TRANSFER_IN_TRANSIT_ATTR)).toBe(false);
    expect(
      document.documentElement.getAttribute(PANEL_TRANSFER_IN_TRANSIT_ATTR)
    ).toBe("panel-1");
    const css =
      document.getElementById("pier-panel-transfer-tear-off-style")
        ?.textContent ?? "";
    expect(css).toContain('.dv-tab:has([data-panel-tab-id="panel-1"])');
  });

  it("treats client points outside the viewport as a tear-off release", () => {
    expect(isDragReleaseOutsideThisWindow({ clientX: -40, clientY: 20 })).toBe(
      true
    );
    expect(isDragReleaseOutsideThisWindow({ clientX: 40, clientY: 20 })).toBe(
      false
    );
  });

  it("treats dragend 0,0 with an off-window screen point as outside", () => {
    const screenX = Object.getOwnPropertyDescriptor(window, "screenX");
    const screenY = Object.getOwnPropertyDescriptor(window, "screenY");
    const outerWidth = Object.getOwnPropertyDescriptor(window, "outerWidth");
    const outerHeight = Object.getOwnPropertyDescriptor(window, "outerHeight");
    Object.defineProperty(window, "screenX", {
      configurable: true,
      value: 200,
    });
    Object.defineProperty(window, "screenY", {
      configurable: true,
      value: 100,
    });
    Object.defineProperty(window, "outerWidth", {
      configurable: true,
      value: 800,
    });
    Object.defineProperty(window, "outerHeight", {
      configurable: true,
      value: 600,
    });
    try {
      expect(
        isDragReleaseOutsideThisWindow({
          clientX: 0,
          clientY: 0,
          screenX: 50,
          screenY: 400,
        })
      ).toBe(true);
    } finally {
      if (screenX) Object.defineProperty(window, "screenX", screenX);
      else Reflect.deleteProperty(window, "screenX");
      if (screenY) Object.defineProperty(window, "screenY", screenY);
      else Reflect.deleteProperty(window, "screenY");
      if (outerWidth) Object.defineProperty(window, "outerWidth", outerWidth);
      else Reflect.deleteProperty(window, "outerWidth");
      if (outerHeight) {
        Object.defineProperty(window, "outerHeight", outerHeight);
      } else {
        Reflect.deleteProperty(window, "outerHeight");
      }
    }
  });

  it("does not reveal while a claim is armed", () => {
    const { tab } = mountTab("panel-1");
    hidePanelTransferTearOff("panel-1", { getPanel: () => undefined } as never);
    armPanelTransferTearOffClaim();
    expect(panelTransferTearOffHoldForTests()).toBe(true);
    revealPanelTransferTearOff();
    expect(tab.hasAttribute(PANEL_TRANSFER_IN_TRANSIT_ATTR)).toBe(true);
    settlePanelTransferTearOffClaim(true);
    expect(tab.hasAttribute(PANEL_TRANSFER_IN_TRANSIT_ATTR)).toBe(true);
    settlePanelTransferTearOffClaim(false);
    expect(tab.hasAttribute(PANEL_TRANSFER_IN_TRANSIT_ATTR)).toBe(false);
    expect(
      document.documentElement.hasAttribute(PANEL_TRANSFER_IN_TRANSIT_ATTR)
    ).toBe(false);
  });

  it("clear restores even after a failed claim hold", () => {
    const { tab } = mountTab("panel-1");
    hidePanelTransferTearOff("panel-1", { getPanel: () => undefined } as never);
    armPanelTransferTearOffClaim();
    clearPanelTransferTearOff();
    expect(tab.hasAttribute(PANEL_TRANSFER_IN_TRANSIT_ATTR)).toBe(false);
    expect(panelTransferTearOffHoldForTests()).toBe(false);
  });
});
