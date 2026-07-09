import { TooltipProvider } from "@pier/ui/tooltip.tsx";
import {
  fireEvent,
  type RenderOptions,
  render as renderBase,
  screen,
} from "@testing-library/react";
import type { IDockviewPanelHeaderProps } from "dockview-react";
import i18next from "i18next";
import { act, type ReactElement } from "react";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { ShellKeybindings } from "@/components/common/shell-keybindings.tsx";
import { PanelTabHeader } from "@/components/workspace/panel-tab-header.tsx";
import { initI18n } from "@/i18n/index.ts";
import { usePanelDescriptorStore } from "@/stores/panel-descriptor.store.ts";
import { useTerminalStore } from "@/stores/terminal.store.ts";

type ActiveChangeHandler = (event: { isActive: boolean }) => void;

function render(ui: ReactElement, options?: RenderOptions) {
  return renderBase(
    <TooltipProvider skipDelayDuration={0}>{ui}</TooltipProvider>,
    options
  );
}

function advanceTooltipDelay(milliseconds: number) {
  act(() => {
    vi.advanceTimersByTime(milliseconds);
  });
}

function createHeaderProps(
  component: string,
  title: string,
  onActiveChange?: (handler: ActiveChangeHandler) => void,
  id = `${component}-1`,
  params: Record<string, unknown> = {}
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
      onDidParametersChange: vi.fn(() => ({ dispose: vi.fn() })),
      onDidTitleChange: vi.fn(() => ({ dispose: vi.fn() })),
      setActive: vi.fn(),
      title,
    },
    containerApi: {},
    params,
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
  beforeAll(async () => {
    await initI18n();
  });

  beforeEach(() => {
    class ResizeObserverMock {
      disconnect(): void {
        // Test polyfill no-op.
      }
      observe(): void {
        // Test polyfill no-op.
      }
      unobserve(): void {
        // Test polyfill no-op.
      }
    }
    vi.stubGlobal("ResizeObserver", ResizeObserverMock);
  });

  afterEach(async () => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    await i18next.changeLanguage("en");
    usePanelDescriptorStore.setState({ activeId: null, descriptors: {} });
    useTerminalStore.getState().resetShortcutHints();
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

  it("uses generic tab chrome for title and icon while showing metadata in a shadcn tooltip", async () => {
    vi.useFakeTimers();
    await i18next.changeLanguage("zh-CN");
    usePanelDescriptorStore.setState({
      activeId: null,
      descriptors: {
        "terminal-1": {
          display: { short: "pier" },
          tab: {
            badge: { label: "package.json" },
            icon: { id: "pier.task", label: "Task" },
            state: { label: "Running", status: "running" },
            title: "test",
            tooltip: {
              lines: [
                { label: "Source", value: "package.json" },
                { label: "Command", value: "pnpm run test" },
                { label: "CWD", value: "$ZED_WORKTREE_ROOT" },
              ],
              title: "test",
            },
          },
        },
      },
    });

    const { container } = render(
      <PanelTabHeader {...createHeaderProps("terminal", "Terminal")} />
    );

    expect(
      container.querySelector(".dv-default-tab-content")
    ).toHaveTextContent("test");
    expect(
      container.querySelector('[data-panel-tab-icon="pier.task"]')
    ).not.toBeNull();
    expect(container.querySelector("[data-tab-busy]")).toBeNull();
    expect(container.querySelector(".dv-default-tab")).toHaveAttribute(
      "aria-label",
      "test, Running"
    );
    expect(container.querySelector(".dv-default-tab")).toHaveAttribute(
      "data-tab-status",
      "running"
    );
    expect(
      container.querySelector("[data-panel-tab-state-indicator]")
    ).toHaveAttribute("data-tab-status", "running");
    expect(
      container.querySelector("[data-panel-tab-state-indicator]")
    ).not.toHaveClass("pier-panel-tab-state-indicator");
    expect(container.querySelector("[data-panel-tab-state-icon]")).toHaveClass(
      "animate-spin",
      "motion-reduce:animate-none"
    );
    expect(
      container.querySelector("[data-panel-tab-state-indicator]")
    ).toHaveAccessibleName("Running");
    expect(container.querySelector("[data-panel-tab-running-ping]")).toBeNull();
    expect(container.querySelector("[data-panel-tab-running-dot]")).toBeNull();
    expect(
      container.querySelector("[data-panel-tab-state-icon]")
    ).toHaveAttribute("data-panel-tab-state-icon", "running");
    expect(container.querySelector("[data-tab-state-label]")).toHaveAttribute(
      "data-tab-state-label",
      "Running"
    );
    expect(container).not.toHaveTextContent("package.json");
    expect(container).not.toHaveTextContent("Running");
    expect(container).not.toHaveTextContent("pnpm run test");
    expect(container.querySelector(".dv-default-tab")).not.toHaveAttribute(
      "title"
    );
    expect(document.querySelector("[data-slot='tooltip-content']")).toBeNull();

    const tabElement = container.querySelector(".dv-default-tab");
    expect(tabElement).not.toBeNull();
    if (!tabElement) {
      return;
    }
    act(() => {
      fireEvent.pointerMove(tabElement, {
        pointerType: "mouse",
      });
    });
    advanceTooltipDelay(999);
    expect(screen.queryByRole("tooltip")).toBeNull();

    advanceTooltipDelay(1);
    const tooltipContent = document.querySelector(
      "[data-slot='tooltip-content']"
    );
    expect(tooltipContent).toHaveAttribute("data-align", "center");
    const tooltip = screen.getByRole("tooltip");
    expect(tooltip).toHaveTextContent("test");
    expect(tooltip).toHaveTextContent("Running");
    expect(tooltip).toHaveTextContent("来源：package.json");
    expect(tooltip).toHaveTextContent("命令：pnpm run test");
    expect(tooltip).toHaveTextContent("目录：$ZED_WORKTREE_ROOT");
    expect(tooltip).not.toHaveClass("pier-panel-tab-tooltip");
  });

  it.each([
    ["running", "Running", "running", "text-primary"],
    ["succeeded", "Succeeded", "succeeded", "text-[var(--status-success-fg)]"],
    ["failed", "Failed 1", "failed", "text-[var(--status-danger-fg)]"],
    [
      "waiting",
      "Waiting for input",
      "waiting",
      "text-[var(--status-warning-fg)]",
    ],
    ["blocked", "Blocked", "blocked", "text-[var(--status-warning-fg)]"],
    ["cancelled", "Cancelled", "cancelled", "text-[var(--status-warning-fg)]"],
  ] as const)("renders the %s tab state as a semantic icon", (status, label, icon, expectedClassName) => {
    usePanelDescriptorStore.setState({
      activeId: null,
      descriptors: {
        "terminal-1": {
          display: { short: "pier" },
          tab: {
            state: { label, status },
            title: "test",
          },
        },
      },
    });

    const { container } = render(
      <PanelTabHeader {...createHeaderProps("terminal", "Terminal")} />
    );

    expect(container.querySelector(".dv-default-tab")).toHaveAttribute(
      "data-tab-status",
      status
    );
    const indicator = container.querySelector(
      "[data-panel-tab-state-indicator]"
    );
    expect(indicator).toHaveAttribute("data-tab-status", status);
    expect(indicator).not.toHaveClass("pier-panel-tab-state-indicator");
    expect(indicator).toHaveAttribute("aria-label", label);
    expect(indicator).not.toHaveTextContent(label);
    expect(
      indicator?.querySelector("[data-panel-tab-state-icon]")
    ).toHaveAttribute("data-panel-tab-state-icon", icon);
    expect(indicator).toHaveClass(expectedClassName);
    if (status === "running") {
      expect(
        indicator?.querySelector("[data-panel-tab-state-icon]")
      ).toHaveClass("motion-reduce:animate-none");
    } else {
      expect(
        indicator?.querySelector("[data-panel-tab-running-ping]")
      ).toBeNull();
    }
  });

  it("does not render a state indicator for idle tabs", () => {
    usePanelDescriptorStore.setState({
      activeId: null,
      descriptors: {
        "terminal-1": {
          display: { short: "pier" },
          tab: {
            state: { label: "Idle", status: "idle" },
            title: "test",
          },
        },
      },
    });

    const { container } = render(
      <PanelTabHeader {...createHeaderProps("terminal", "Terminal")} />
    );

    expect(
      container.querySelector("[data-panel-tab-state-indicator]")
    ).toBeNull();
  });

  it("closes the metadata tooltip when the pointer leaves the tab", () => {
    vi.useFakeTimers();
    usePanelDescriptorStore.setState({
      activeId: null,
      descriptors: {
        "terminal-1": {
          display: { short: "pier" },
          tab: {
            title: "dev",
            tooltip: {
              lines: [{ label: "Command", value: "bun run dev" }],
              title: "dev",
            },
          },
        },
      },
    });

    const { container } = render(
      <PanelTabHeader {...createHeaderProps("terminal", "Terminal")} />
    );
    const tabElement = container.querySelector(".dv-default-tab");
    expect(tabElement).not.toBeNull();
    if (!tabElement) {
      return;
    }

    act(() => {
      fireEvent.pointerMove(tabElement, {
        pointerType: "mouse",
      });
    });
    advanceTooltipDelay(1000);
    expect(screen.getByRole("tooltip")).toHaveTextContent("dev");

    act(() => {
      fireEvent.pointerOut(tabElement, {
        pointerType: "mouse",
        relatedTarget: document.body,
      });
      fireEvent.pointerLeave(tabElement, {
        pointerType: "mouse",
        relatedTarget: document.body,
      });
    });

    expect(screen.queryByRole("tooltip")).toBeNull();
  });

  it("does not open the metadata tooltip while Command is held", () => {
    vi.useFakeTimers();
    usePanelDescriptorStore.setState({
      activeId: null,
      descriptors: {
        "terminal-1": {
          display: { short: "pier" },
          tab: {
            title: "dev",
            tooltip: {
              lines: [{ label: "Command", value: "bun run dev" }],
              title: "dev",
            },
          },
        },
      },
    });
    useTerminalStore.setState({
      activeGroupTabHints: { "terminal-1": 1 },
      commandKeyDown: true,
    });

    const { container } = render(
      <PanelTabHeader {...createHeaderProps("terminal", "Terminal")} />
    );
    const tabElement = container.querySelector(".dv-default-tab");
    expect(tabElement).not.toBeNull();
    if (!tabElement) {
      return;
    }

    act(() => {
      fireEvent.pointerMove(tabElement, {
        pointerType: "mouse",
      });
    });
    advanceTooltipDelay(1000);

    expect(screen.queryByRole("tooltip")).toBeNull();
    expect(
      container.querySelector("[data-panel-tab-index-hint]")
    ).toHaveTextContent("⌘1");
  });

  it("closes an open metadata tooltip when Command is pressed", () => {
    vi.useFakeTimers();
    usePanelDescriptorStore.setState({
      activeId: null,
      descriptors: {
        "terminal-1": {
          display: { short: "pier" },
          tab: {
            title: "dev",
            tooltip: {
              lines: [{ label: "Command", value: "bun run dev" }],
              title: "dev",
            },
          },
        },
      },
    });
    useTerminalStore.getState().setActiveGroupPanels([{ id: "terminal-1" }]);

    const { container } = render(
      <PanelTabHeader {...createHeaderProps("terminal", "Terminal")} />
    );
    const tabElement = container.querySelector(".dv-default-tab");
    expect(tabElement).not.toBeNull();
    if (!tabElement) {
      return;
    }

    act(() => {
      fireEvent.pointerMove(tabElement, {
        pointerType: "mouse",
      });
    });
    advanceTooltipDelay(1000);
    expect(screen.getByRole("tooltip")).toHaveTextContent("dev");

    act(() => {
      useTerminalStore.getState().setCommandKeyDown(true);
    });

    expect(screen.queryByRole("tooltip")).toBeNull();
    expect(
      container.querySelector("[data-panel-tab-index-hint]")
    ).toHaveTextContent("⌘1");
  });

  it("keeps tab tooltips delayed across repeated adjacent tab moves", () => {
    vi.useFakeTimers();
    usePanelDescriptorStore.setState({
      activeId: null,
      descriptors: {
        "terminal-1": {
          display: { short: "one" },
          tab: {
            title: "one",
            tooltip: {
              lines: [{ label: "Command", value: "pnpm dev" }],
              title: "one",
            },
          },
        },
        "terminal-2": {
          display: { short: "two" },
          tab: {
            title: "two",
            tooltip: {
              lines: [{ label: "Command", value: "pnpm test" }],
              title: "two",
            },
          },
        },
        "terminal-3": {
          display: { short: "three" },
          tab: {
            title: "three",
            tooltip: {
              lines: [{ label: "Command", value: "pnpm build" }],
              title: "three",
            },
          },
        },
      },
    });

    const { container } = render(
      <>
        <PanelTabHeader {...createHeaderProps("terminal", "Terminal")} />
        <PanelTabHeader
          {...createHeaderProps(
            "terminal",
            "Terminal",
            undefined,
            "terminal-2"
          )}
        />
        <PanelTabHeader
          {...createHeaderProps(
            "terminal",
            "Terminal",
            undefined,
            "terminal-3"
          )}
        />
      </>
    );
    const [firstTab, secondTab, thirdTab] = Array.from(
      container.querySelectorAll(".dv-default-tab")
    );
    expect(firstTab).not.toBeUndefined();
    expect(secondTab).not.toBeUndefined();
    expect(thirdTab).not.toBeUndefined();
    if (!(firstTab && secondTab && thirdTab)) {
      return;
    }

    act(() => {
      fireEvent.pointerMove(firstTab, {
        pointerType: "mouse",
      });
    });
    advanceTooltipDelay(1000);
    expect(screen.getByRole("tooltip")).toHaveTextContent("one");

    act(() => {
      fireEvent.pointerOut(firstTab, {
        pointerType: "mouse",
        relatedTarget: secondTab,
      });
      fireEvent.pointerLeave(firstTab, {
        pointerType: "mouse",
        relatedTarget: secondTab,
      });
      fireEvent.pointerMove(secondTab, {
        pointerType: "mouse",
      });
    });

    expect(screen.queryByRole("tooltip")).toBeNull();
    advanceTooltipDelay(999);
    expect(screen.queryByRole("tooltip")).toBeNull();
    advanceTooltipDelay(1);
    expect(screen.getByRole("tooltip")).toHaveTextContent("two");

    act(() => {
      fireEvent.pointerOut(secondTab, {
        pointerType: "mouse",
        relatedTarget: thirdTab,
      });
      fireEvent.pointerLeave(secondTab, {
        pointerType: "mouse",
        relatedTarget: thirdTab,
      });
    });

    act(() => {
      fireEvent.pointerMove(thirdTab, {
        pointerType: "mouse",
      });
    });

    expect(screen.queryByRole("tooltip")).toBeNull();
    advanceTooltipDelay(999);
    expect(screen.queryByRole("tooltip")).toBeNull();
    advanceTooltipDelay(1);
    expect(screen.getByRole("tooltip")).toHaveTextContent("three");
  });

  it("falls back to the panel kit icon when tab chrome icon id is unknown", () => {
    usePanelDescriptorStore.setState({
      activeId: null,
      descriptors: {
        "terminal-1": {
          display: { short: "pier" },
          tab: {
            icon: { id: "plugin.missing.icon" },
            title: "plugin tab",
          },
        },
      },
    });

    const { container } = render(
      <PanelTabHeader {...createHeaderProps("terminal", "Terminal")} />
    );

    expect(
      container.querySelector('[data-panel-tab-icon="terminal"]')
    ).not.toBeNull();
  });

  it("does not render an icon for unknown panel kits", () => {
    const { container } = render(
      <PanelTabHeader {...createHeaderProps("unknown", "Unknown")} />
    );

    expect(container.querySelector("[data-panel-tab-icon]")).toBeNull();
  });

  it("replaces the active group tab icon with its shortcut number while Command is held", () => {
    usePanelDescriptorStore.setState({
      activeId: null,
      descriptors: {
        "terminal-1": {
          display: { short: "pier" },
          tab: {
            state: { label: "Running", status: "running" },
            title: "test",
          },
        },
      },
    });
    useTerminalStore.setState({
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
    expect(
      container.querySelector("[data-panel-tab-state-indicator]")
    ).toHaveAttribute("data-tab-status", "running");
  });

  it("keeps the original icon for tabs outside the active group while Command is held", () => {
    useTerminalStore.setState({
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
    useTerminalStore.getState().setActiveGroupPanels([{ id: "terminal-1" }]);

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

    fireEvent.keyDown(window, { code: "Digit1", metaKey: true });
    fireEvent.keyUp(window, { code: "Digit1", metaKey: false });
    expect(
      container.querySelector("[data-panel-tab-index-hint]")
    ).toHaveTextContent("⌘1");

    fireEvent.keyUp(window, { code: "MetaLeft", metaKey: false });
    expect(container.querySelector("[data-panel-tab-index-hint]")).toBeNull();
    expect(
      container.querySelector('[data-panel-tab-icon="terminal"]')
    ).not.toBeNull();
  });

  it("marks only file preview tabs with preview chrome", () => {
    const { container: previewContainer } = render(
      <PanelTabHeader
        {...createHeaderProps(
          "pier.files.filePanel",
          "README.md",
          undefined,
          "pier.files.filePanel:disk:abc",
          { pinned: false }
        )}
      />
    );
    expect(
      previewContainer.querySelector('[data-pier-tab-preview="true"]')
    ).not.toBeNull();

    const { container: terminalContainer } = render(
      <PanelTabHeader {...createHeaderProps("terminal", "Terminal")} />
    );
    expect(
      terminalContainer.querySelector('[data-pier-tab-preview="true"]')
    ).toBeNull();

    const { container: welcomeContainer } = render(
      <PanelTabHeader {...createHeaderProps("welcome", "Welcome")} />
    );
    expect(
      welcomeContainer.querySelector('[data-pier-tab-preview="true"]')
    ).toBeNull();
  });

  it("pins only file preview tabs when double-clicking tab content", () => {
    const terminalUpdateParameters = vi.fn();
    const terminalProps = createHeaderProps(
      "terminal",
      "Terminal",
      undefined,
      "terminal-1",
      { pinned: false }
    );
    Object.assign(terminalProps.api, {
      updateParameters: terminalUpdateParameters,
    });
    const { container: terminalContainer } = render(
      <PanelTabHeader {...terminalProps} />
    );

    const terminalTab = terminalContainer.querySelector(
      '[data-panel-tab-id="terminal-1"]'
    );
    expect(terminalTab).not.toBeNull();
    fireEvent.doubleClick(terminalTab as HTMLElement);
    expect(terminalUpdateParameters).not.toHaveBeenCalled();

    const fileUpdateParameters = vi.fn();
    const fileProps = createHeaderProps(
      "pier.files.filePanel",
      "README.md",
      undefined,
      "pier.files.filePanel:disk:abc",
      { pinned: false, uri: "file:///workspace/README.md" }
    );
    Object.assign(fileProps.api, { updateParameters: fileUpdateParameters });
    const fileDoubleClickBubble = vi.fn();
    const { container: fileContainer } = render(
      <button onDoubleClick={fileDoubleClickBubble} type="button">
        <PanelTabHeader {...fileProps} />
      </button>
    );

    const fileTab = fileContainer.querySelector(
      '[data-panel-tab-id="pier.files.filePanel:disk:abc"]'
    );
    expect(fileTab).not.toBeNull();
    fireEvent.doubleClick(fileTab as HTMLElement);

    expect(fileUpdateParameters).toHaveBeenCalledTimes(1);
    expect(fileUpdateParameters).toHaveBeenCalledWith({
      pinned: true,
      uri: "file:///workspace/README.md",
    });
    expect(fileDoubleClickBubble).not.toHaveBeenCalled();
  });
});
