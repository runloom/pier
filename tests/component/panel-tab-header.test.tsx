import { fireEvent, render } from "@testing-library/react";
import type { IDockviewPanelHeaderProps } from "dockview-react";
import { act } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ShellKeybindings } from "@/components/common/shell-keybindings.tsx";
import { PanelTabHeader } from "@/components/workspace/panel-tab-header.tsx";
import { useTabShortcutHintsStore } from "@/stores/tab-shortcut-hints.store.ts";

type ActiveChangeHandler = (event: { isActive: boolean }) => void;

function createHeaderProps(
  component: string,
  title: string,
  onActiveChange?: (handler: ActiveChangeHandler) => void,
  id = `${component}-1`
): IDockviewPanelHeaderProps {
  return {
    api: {
      component,
      id,
      isActive: false,
      onDidActiveChange: vi.fn((handler: ActiveChangeHandler) => {
        onActiveChange?.(handler);
        return { dispose: vi.fn() };
      }),
      onDidTitleChange: vi.fn(() => ({ dispose: vi.fn() })),
      setActive: vi.fn(),
      title,
    },
    containerApi: {},
    params: {},
    tabLocation: "header",
  } as unknown as IDockviewPanelHeaderProps;
}

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

describe("PanelTabHeader", () => {
  afterEach(() => {
    useTabShortcutHintsStore.getState().reset();
  });

  it("renders the icon declared by the panel kit metadata", () => {
    const { container } = render(
      <PanelTabHeader {...createHeaderProps("terminal", "Terminal")} />
    );

    expect(
      container.querySelector('[data-panel-tab-icon="terminal"]')
    ).not.toBeNull();
  });

  it("does not reveal its own dockview tab when it becomes active", async () => {
    let activeChange: ActiveChangeHandler | null = null;
    const tabsContainer = document.createElement("div");
    tabsContainer.className = "dv-tabs-container";
    const dockviewTab = document.createElement("div");
    dockviewTab.className = "dv-tab";
    tabsContainer.append(dockviewTab);
    document.body.append(tabsContainer);
    setRect(tabsContainer, { bottom: 34, left: 0, right: 200, top: 0 });
    setRect(dockviewTab, { bottom: 34, left: 160, right: 260, top: 0 });
    const { container } = render(
      <PanelTabHeader
        {...createHeaderProps("terminal", "Terminal", (handler) => {
          activeChange = handler;
        })}
      />,
      { container: dockviewTab }
    );
    expect(container.querySelector(".dv-default-tab")).not.toBeNull();

    await act(async () => {
      activeChange?.({ isActive: true });
      await new Promise(requestAnimationFrame);
    });

    expect(tabsContainer.scrollLeft).toBe(0);
    tabsContainer.remove();
  });

  it("renders a different icon for a different panel kit", () => {
    const { container } = render(
      <PanelTabHeader {...createHeaderProps("welcome", "Welcome")} />
    );

    expect(
      container.querySelector('[data-panel-tab-icon="welcome"]')
    ).not.toBeNull();
  });

  it("does not render an icon for unknown panel kits", () => {
    const { container } = render(
      <PanelTabHeader {...createHeaderProps("unknown", "Unknown")} />
    );

    expect(container.querySelector("[data-panel-tab-icon]")).toBeNull();
  });

  it("replaces the active group tab icon with its shortcut number while Command is held", () => {
    useTabShortcutHintsStore.setState({
      activeGroupTabHints: { "terminal-1": 1 },
      commandKeyDown: true,
    });

    const { container } = render(
      <PanelTabHeader {...createHeaderProps("terminal", "Terminal")} />
    );

    expect(container.querySelector("[data-panel-tab-icon]")).toBeNull();
    expect(
      container.querySelector("[data-panel-tab-index-hint]")
    ).toHaveTextContent("⌘1");
  });

  it("keeps the original icon for tabs outside the active group while Command is held", () => {
    useTabShortcutHintsStore.setState({
      activeGroupTabHints: { "terminal-1": 1 },
      commandKeyDown: true,
    });

    const { container } = render(
      <PanelTabHeader
        {...createHeaderProps("terminal", "Terminal", undefined, "terminal-2")}
      />
    );

    expect(
      container.querySelector('[data-panel-tab-icon="terminal"]')
    ).not.toBeNull();
    expect(container.querySelector("[data-panel-tab-index-hint]")).toBeNull();
  });

  it("toggles the active group tab shortcut hint from web Command key events", () => {
    useTabShortcutHintsStore
      .getState()
      .setActiveGroupPanels([{ id: "terminal-1" }]);

    const { container } = render(
      <>
        <ShellKeybindings />
        <PanelTabHeader {...createHeaderProps("terminal", "Terminal")} />
      </>
    );

    expect(container.querySelector("[data-panel-tab-index-hint]")).toBeNull();

    fireEvent.keyDown(window, { code: "MetaLeft", metaKey: true });
    expect(
      container.querySelector("[data-panel-tab-index-hint]")
    ).toHaveTextContent("⌘1");

    fireEvent.keyUp(window, { code: "MetaLeft", metaKey: false });
    expect(container.querySelector("[data-panel-tab-index-hint]")).toBeNull();
    expect(
      container.querySelector('[data-panel-tab-icon="terminal"]')
    ).not.toBeNull();
  });
});
