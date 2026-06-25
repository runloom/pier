import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { IDockviewHeaderActionsProps } from "dockview-react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WorkspaceHeaderActions } from "@/components/workspace/workspace-header-actions.tsx";

let setOverlayActive: ReturnType<typeof vi.fn>;
let originalHasPointerCapture:
  | typeof HTMLElement.prototype.hasPointerCapture
  | undefined;
let originalReleasePointerCapture:
  | typeof HTMLElement.prototype.releasePointerCapture
  | undefined;
let originalSetPointerCapture:
  | typeof HTMLElement.prototype.setPointerCapture
  | undefined;
let originalScrollIntoView:
  | typeof HTMLElement.prototype.scrollIntoView
  | undefined;

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

function createPanel(id: string, title: string) {
  return {
    api: {
      onDidTitleChange: vi.fn(() => ({ dispose: vi.fn() })),
      setActive: vi.fn(),
    },
    id,
    title,
    view: {
      contentComponent: "terminal",
    },
  };
}

function createProps(
  panels: ReturnType<typeof createPanel>[]
): IDockviewHeaderActionsProps {
  return {
    activePanel: panels[0],
    api: {},
    containerApi: {
      addPanel: vi.fn(),
    },
    group: {},
    headerPosition: "top",
    isGroupActive: true,
    panels,
  } as unknown as IDockviewHeaderActionsProps;
}

beforeEach(() => {
  setOverlayActive = vi.fn();
  originalHasPointerCapture = HTMLElement.prototype.hasPointerCapture;
  originalReleasePointerCapture = HTMLElement.prototype.releasePointerCapture;
  originalSetPointerCapture = HTMLElement.prototype.setPointerCapture;
  originalScrollIntoView = HTMLElement.prototype.scrollIntoView;
  Object.defineProperties(HTMLElement.prototype, {
    hasPointerCapture: {
      configurable: true,
      value: vi.fn(() => false),
    },
    releasePointerCapture: {
      configurable: true,
      value: vi.fn(),
    },
    setPointerCapture: {
      configurable: true,
      value: vi.fn(),
    },
    scrollIntoView: {
      configurable: true,
      value: vi.fn(),
    },
  });
  Object.defineProperty(window, "pier", {
    configurable: true,
    value: {
      terminal: {
        setOverlayActive,
      },
    },
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  if (originalHasPointerCapture) {
    HTMLElement.prototype.hasPointerCapture = originalHasPointerCapture;
  } else {
    Reflect.deleteProperty(HTMLElement.prototype, "hasPointerCapture");
  }
  if (originalReleasePointerCapture) {
    HTMLElement.prototype.releasePointerCapture = originalReleasePointerCapture;
  } else {
    Reflect.deleteProperty(HTMLElement.prototype, "releasePointerCapture");
  }
  if (originalSetPointerCapture) {
    HTMLElement.prototype.setPointerCapture = originalSetPointerCapture;
  } else {
    Reflect.deleteProperty(HTMLElement.prototype, "setPointerCapture");
  }
  if (originalScrollIntoView) {
    HTMLElement.prototype.scrollIntoView = originalScrollIntoView;
  } else {
    Reflect.deleteProperty(HTMLElement.prototype, "scrollIntoView");
  }
  Reflect.deleteProperty(window, "pier");
});

describe("WorkspaceHeaderActions", () => {
  it("renders a select trigger for clipped tabs", async () => {
    const header = document.createElement("div");
    const tabsContainer = document.createElement("div");
    const firstTab = document.createElement("div");
    const firstContent = document.createElement("div");
    const secondTab = document.createElement("div");
    const secondContent = document.createElement("div");
    const actionsContainer = document.createElement("div");

    header.className = "dv-tabs-and-actions-container";
    tabsContainer.className = "dv-tabs-container";
    firstTab.className = "dv-tab";
    secondTab.className = "dv-tab";
    firstContent.dataset.panelTabId = "terminal-1";
    secondContent.dataset.panelTabId = "terminal-2";
    firstTab.append(firstContent);
    secondTab.append(secondContent);
    tabsContainer.append(firstTab, secondTab);
    header.append(tabsContainer, actionsContainer);
    document.body.append(header);

    setRect(tabsContainer, { bottom: 34, left: 0, right: 120, top: 0 });
    setRect(firstTab, { bottom: 34, left: 0, right: 80, top: 0 });
    setRect(secondTab, { bottom: 34, left: 120, right: 200, top: 0 });

    render(
      <WorkspaceHeaderActions
        {...createProps([
          createPanel("terminal-1", "Terminal 1"),
          createPanel("terminal-2", "Terminal 2"),
        ])}
      />,
      { container: actionsContainer }
    );

    expect(
      await screen.findByRole("combobox", { name: "Hidden tabs" })
    ).toHaveTextContent("1");

    header.remove();
  });

  it("pushes terminal overlay while the select list is open so options receive pointer events", async () => {
    const header = document.createElement("div");
    const tabsContainer = document.createElement("div");
    const visibleTab = document.createElement("div");
    const visibleContent = document.createElement("div");
    const overflowTab = document.createElement("div");
    const overflowContent = document.createElement("div");
    const actionsContainer = document.createElement("div");
    const overflowPanel = createPanel("terminal-2", "Terminal 2");

    header.className = "dv-tabs-and-actions-container";
    tabsContainer.className = "dv-tabs-container";
    visibleTab.className = "dv-tab";
    overflowTab.className = "dv-tab";
    visibleContent.dataset.panelTabId = "terminal-1";
    overflowContent.dataset.panelTabId = "terminal-2";
    visibleTab.append(visibleContent);
    overflowTab.append(overflowContent);
    tabsContainer.append(visibleTab, overflowTab);
    header.append(tabsContainer, actionsContainer);
    document.body.append(header);

    setRect(tabsContainer, { bottom: 34, left: 0, right: 120, top: 0 });
    setRect(visibleTab, { bottom: 34, left: 0, right: 80, top: 0 });
    setRect(overflowTab, { bottom: 34, left: 120, right: 200, top: 0 });

    render(
      <WorkspaceHeaderActions
        {...createProps([
          createPanel("terminal-1", "Terminal 1"),
          overflowPanel,
        ])}
      />,
      { container: actionsContainer }
    );

    const trigger = await screen.findByRole("combobox", {
      name: "Hidden tabs",
    });
    fireEvent.pointerDown(trigger, {
      button: 0,
      ctrlKey: false,
      pointerType: "mouse",
    });

    await waitFor(() => {
      expect(setOverlayActive).toHaveBeenLastCalledWith(true);
    });
    const item = await screen.findByRole("option", {
      name: "Terminal 2",
    });
    expect(item).toHaveAttribute("data-slot", "select-item");
    expect(document.querySelector("[data-slot='select-content']")).toHaveClass(
      "w-48"
    );

    fireEvent.click(item);

    expect(overflowPanel.api.setActive).toHaveBeenCalledTimes(1);
    await waitFor(() => {
      expect(setOverlayActive).toHaveBeenLastCalledWith(false);
    });

    header.remove();
  });

  it("reveals the hidden tab when selecting it from the overflow list", async () => {
    const header = document.createElement("div");
    const tabsContainer = document.createElement("div");
    const visibleTab = document.createElement("div");
    const visibleContent = document.createElement("div");
    const overflowTab = document.createElement("div");
    const overflowContent = document.createElement("div");
    const actionsContainer = document.createElement("div");
    const overflowPanel = createPanel("terminal-2", "xyz");

    header.className = "dv-tabs-and-actions-container";
    tabsContainer.className = "dv-tabs-container";
    visibleTab.className = "dv-tab";
    overflowTab.className = "dv-tab";
    visibleContent.dataset.panelTabId = "terminal-1";
    overflowContent.dataset.panelTabId = "terminal-2";
    visibleTab.append(visibleContent);
    overflowTab.append(overflowContent);
    tabsContainer.append(visibleTab, overflowTab);
    header.append(tabsContainer, actionsContainer);
    document.body.append(header);

    tabsContainer.scrollLeft = 0;
    setRect(tabsContainer, { bottom: 34, left: 0, right: 120, top: 0 });
    setRect(visibleTab, { bottom: 34, left: 0, right: 80, top: 0 });
    setRect(overflowTab, { bottom: 34, left: 120, right: 200, top: 0 });

    render(
      <WorkspaceHeaderActions
        {...createProps([
          createPanel("terminal-1", "Terminal 1"),
          overflowPanel,
        ])}
      />,
      { container: actionsContainer }
    );

    const trigger = await screen.findByRole("combobox", {
      name: "Hidden tabs",
    });
    fireEvent.pointerDown(trigger, {
      button: 0,
      ctrlKey: false,
      pointerType: "mouse",
    });

    fireEvent.click(
      await screen.findByRole("option", {
        name: "xyz",
      })
    );

    expect(overflowPanel.api.setActive).toHaveBeenCalledTimes(1);
    expect(tabsContainer.scrollLeft).toBe(88);

    header.remove();
  });

  it("uses the select native viewport for a long hidden tab list", async () => {
    const header = document.createElement("div");
    const tabsContainer = document.createElement("div");
    const actionsContainer = document.createElement("div");
    const panels = Array.from({ length: 8 }, (_, index) =>
      createPanel(`terminal-${index + 1}`, `Terminal ${index + 1}`)
    );

    header.className = "dv-tabs-and-actions-container";
    tabsContainer.className = "dv-tabs-container";

    panels.forEach((panel, index) => {
      const tab = document.createElement("div");
      const content = document.createElement("div");
      tab.className = "dv-tab";
      content.dataset.panelTabId = panel.id;
      tab.append(content);
      tabsContainer.append(tab);
      setRect(tab, {
        bottom: 34,
        left: index * 80,
        right: index * 80 + 80,
        top: 0,
      });
    });

    header.append(tabsContainer, actionsContainer);
    document.body.append(header);

    setRect(tabsContainer, { bottom: 34, left: 0, right: 80, top: 0 });

    render(<WorkspaceHeaderActions {...createProps(panels)} />, {
      container: actionsContainer,
    });

    const trigger = await screen.findByRole("combobox", {
      name: "Hidden tabs",
    });
    fireEvent.pointerDown(trigger, {
      button: 0,
      ctrlKey: false,
      pointerType: "mouse",
    });

    await screen.findByRole("option", {
      name: "Terminal 2",
    });
    const content = document.querySelector("[data-slot='select-content']");
    const viewport = document.querySelector("[data-radix-select-viewport]");
    expect(viewport).not.toBeNull();
    expect(content).toHaveAttribute("data-align-trigger", "false");
    expect(content).toHaveClass("w-48");
    expect(viewport).toHaveAttribute("data-position", "popper");
    expect(
      document.querySelector("[data-overflow-tabs-viewport]")
    ).not.toBeInTheDocument();

    header.remove();
  });
});
