import { describe, expect, it } from "vitest";
import { getOverflowPanelIds } from "@/components/workspace/panel-overflow.tsx";

function setRect(
  element: HTMLElement,
  rect: Pick<DOMRect, "bottom" | "left" | "right" | "top">
): void {
  element.getBoundingClientRect = () =>
    ({
      bottom: rect.bottom,
      height: rect.bottom - rect.top,
      left: rect.left,
      right: rect.right,
      top: rect.top,
      width: rect.right - rect.left,
      x: rect.left,
      y: rect.top,
      toJSON: () => ({}),
    }) as DOMRect;
}

describe("workspace tab overflow", () => {
  it("returns panels whose dockview tabs are fully outside the tab strip", () => {
    const tabsContainer = document.createElement("div");
    const firstTab = document.createElement("div");
    const firstTabContent = document.createElement("div");
    const secondTab = document.createElement("div");
    const secondTabContent = document.createElement("div");

    firstTab.className = "dv-tab";
    secondTab.className = "dv-tab";
    firstTabContent.dataset.panelTabId = "terminal-1";
    secondTabContent.dataset.panelTabId = "terminal-2";
    firstTab.append(firstTabContent);
    secondTab.append(secondTabContent);
    tabsContainer.append(firstTab, secondTab);

    setRect(tabsContainer, { bottom: 34, left: 0, right: 120, top: 0 });
    setRect(firstTab, { bottom: 34, left: 0, right: 80, top: 0 });
    setRect(secondTab, { bottom: 34, left: 120, right: 200, top: 0 });

    expect(
      getOverflowPanelIds(tabsContainer, [
        { id: "terminal-1" },
        { id: "terminal-2" },
      ])
    ).toEqual(["terminal-2"]);
  });

  it("does not return tabs that are partially visible in the tab strip", () => {
    const tabsContainer = document.createElement("div");
    const firstTab = document.createElement("div");
    const firstTabContent = document.createElement("div");
    const secondTab = document.createElement("div");
    const secondTabContent = document.createElement("div");

    firstTab.className = "dv-tab";
    secondTab.className = "dv-tab";
    firstTabContent.dataset.panelTabId = "terminal-1";
    secondTabContent.dataset.panelTabId = "terminal-2";
    firstTab.append(firstTabContent);
    secondTab.append(secondTabContent);
    tabsContainer.append(firstTab, secondTab);

    setRect(tabsContainer, { bottom: 34, left: 0, right: 120, top: 0 });
    setRect(firstTab, { bottom: 34, left: 0, right: 80, top: 0 });
    setRect(secondTab, { bottom: 34, left: 80, right: 160, top: 0 });

    expect(
      getOverflowPanelIds(tabsContainer, [
        { id: "terminal-1" },
        { id: "terminal-2" },
      ])
    ).toEqual([]);
  });

  it("returns clipped panel ids in the dockview tab DOM order", () => {
    const tabsContainer = document.createElement("div");
    const firstTab = document.createElement("div");
    const firstTabContent = document.createElement("div");
    const secondTab = document.createElement("div");
    const secondTabContent = document.createElement("div");
    const thirdTab = document.createElement("div");
    const thirdTabContent = document.createElement("div");

    firstTab.className = "dv-tab";
    secondTab.className = "dv-tab";
    thirdTab.className = "dv-tab";
    firstTabContent.dataset.panelTabId = "terminal-1";
    secondTabContent.dataset.panelTabId = "terminal-abc";
    thirdTabContent.dataset.panelTabId = "terminal-3";
    firstTab.append(firstTabContent);
    secondTab.append(secondTabContent);
    thirdTab.append(thirdTabContent);
    tabsContainer.append(firstTab, secondTab, thirdTab);

    setRect(tabsContainer, { bottom: 34, left: 0, right: 80, top: 0 });
    setRect(firstTab, { bottom: 34, left: 0, right: 80, top: 0 });
    setRect(secondTab, { bottom: 34, left: 80, right: 160, top: 0 });
    setRect(thirdTab, { bottom: 34, left: 160, right: 240, top: 0 });

    expect(
      getOverflowPanelIds(tabsContainer, [
        { id: "terminal-3" },
        { id: "terminal-1" },
        { id: "terminal-abc" },
      ])
    ).toEqual(["terminal-abc", "terminal-3"]);
  });
});
