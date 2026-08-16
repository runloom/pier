import { TooltipProvider } from "@pier/ui/tooltip.tsx";
import { emptyTaskRunsSnapshot } from "@shared/contracts/tasks.ts";
import {
  fireEvent,
  type RenderOptions,
  render as renderBase,
  screen,
  waitFor,
} from "@testing-library/react";
import {
  DockviewReact,
  type DockviewReadyEvent,
  type IDockviewPanelHeaderProps,
} from "dockview-react";
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
import { PanelTabHeader } from "@/components/workspace/panel-tab-header.tsx";
import {
  PANEL_TAB_TOOLTIP_DELAY_MS,
  PANEL_TAB_TOOLTIP_SKIP_DELAY_MS,
} from "@/components/workspace/panel-tab-tooltip.tsx";
import { initI18n } from "@/i18n/index.ts";
import { actionRegistry } from "@/lib/actions/registry.ts";
import { usePanelDescriptorStore } from "@/stores/panel-descriptor.store.ts";
import { useTaskRunsStore } from "@/stores/task-runs.store.ts";
import { requestTerminalFocusIntent } from "@/stores/terminal-input-routing-slice.ts";

type ActiveChangeHandler = (event: { isActive: boolean }) => void;

const contextActionDisposers: Array<() => void> = [];
vi.mock("@/stores/terminal-input-routing-slice.ts", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("@/stores/terminal-input-routing-slice.ts")
  >()),
  requestTerminalFocusIntent: vi.fn(),
}));

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

function tabTooltipTrigger(tab: Element): Element {
  return tab.querySelector("[data-slot='tooltip-trigger']") ?? tab;
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
    vi.mocked(requestTerminalFocusIntent).mockClear();
  });

  afterEach(async () => {
    for (const dispose of contextActionDisposers.splice(0)) {
      dispose();
    }
    vi.useRealTimers();
    vi.unstubAllGlobals();
    await i18next.changeLanguage("en");
    usePanelDescriptorStore.setState({ activeId: null, descriptors: {} });
    useTaskRunsStore.setState({
      error: null,
      initialized: false,
      snapshot: emptyTaskRunsSnapshot(),
    });
  });

  it("replays terminal ownership when its selected tab is clicked", () => {
    const props = createHeaderProps("terminal", "Terminal");
    Object.assign(props.api, { isActive: true });
    const { container } = render(<PanelTabHeader {...props} />);
    const tab = container.querySelector(
      '[data-panel-tab-id="terminal-1"]'
    ) as Element;

    fireEvent.pointerDown(tab, { button: 0, detail: 1 });
    fireEvent.click(tab);

    expect(requestTerminalFocusIntent).toHaveBeenCalledWith("terminal-1");
  });

  it("does not treat close-button keyboard activation as a tab focus intent", () => {
    render(<PanelTabHeader {...createHeaderProps("terminal", "Terminal")} />);

    fireEvent.keyDown(
      screen.getByRole("button", { name: i18next.t("workspace.tab.close") }),
      {
        key: "Enter",
      }
    );

    expect(requestTerminalFocusIntent).not.toHaveBeenCalled();
  });

  it("labels the close control via i18n", () => {
    render(<PanelTabHeader {...createHeaderProps("terminal", "Terminal")} />);
    expect(
      screen.getByRole("button", { name: i18next.t("workspace.tab.close") })
    ).toBeTruthy();
  });

  it("renders the icon declared by the panel kit metadata", () => {
    const { container } = render(
      <PanelTabHeader {...createHeaderProps("terminal", "Terminal")} />
    );

    expect(
      container.querySelector('[data-panel-tab-icon="terminal"]')
    ).not.toBeNull();
  });

  it("routes a tab context-menu action with the source panel identity", async () => {
    const handler = vi.fn();
    contextActionDisposers.push(
      actionRegistry.register({
        category: "Test",
        handler,
        id: "pier.test.tabContext",
        surfaces: ["dockview-tab"],
        title: () => "Tab action",
      })
    );
    Object.defineProperty(window, "pier", {
      configurable: true,
      value: {
        menu: {
          popup: vi.fn(async () => ({ actionId: "pier.test.tabContext" })),
        },
      },
    });
    const props = createHeaderProps(
      "terminal",
      "Task",
      undefined,
      "terminal-task"
    );
    Object.assign(props.api, { group: { id: "group-task" } });
    usePanelDescriptorStore.setState({
      activeId: "terminal-task",
      descriptors: {
        "terminal-task": {
          context: {
            contextId: "ctx-task",
            projectRootPath: "/repo",
            updatedAt: 1,
          },
          display: { short: "Task" },
        },
      },
    });

    const { container } = render(<PanelTabHeader {...props} />);
    fireEvent.contextMenu(
      container.querySelector('[data-panel-tab-id="terminal-task"]') as Element
    );

    await waitFor(() => {
      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({
          sourcePanelComponent: "terminal",
          sourcePanelContext: expect.objectContaining({
            projectRootPath: "/repo",
          }),
          sourcePanelGroupId: "group-task",
          sourcePanelId: "terminal-task",
          surface: "dockview-tab",
        })
      );
    });
    // 右键不预激活：关 inactive tab 时保持当前 active（adjacent 策略）。
    expect(props.api.setActive).not.toHaveBeenCalled();
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
      "test, Running, 来源：package.json, 命令：pnpm run test, 目录：$ZED_WORKTREE_ROOT"
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
    // running：视觉在 .dv-tab::before；DOM 仅 a11y 锚点（无行内 spinner / 内层可见轨）
    expect(container.querySelector("[data-panel-tab-state-icon]")).toBeNull();
    expect(
      container.querySelector("[data-panel-tab-state-indicator]")
    ).toHaveClass("pier-tab-running-bar");
    expect(
      container.querySelector("[data-panel-tab-running-segment]")
    ).toBeNull();
    expect(
      container.querySelector("[data-panel-tab-running-track]")
    ).toBeNull();
    expect(
      container.querySelector("[data-panel-tab-state-indicator]")
    ).toHaveAccessibleName("Running");
    expect(container.querySelector("[data-panel-tab-running-ping]")).toBeNull();
    expect(container.querySelector("[data-panel-tab-running-dot]")).toBeNull();
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
    expect(
      container.querySelector("[data-panel-tab-state-indicator]")
    ).not.toHaveAttribute("title");
    expect(document.querySelector("[data-slot='tooltip-content']")).toBeNull();

    const tabElement = container.querySelector(".dv-default-tab");
    expect(tabElement).not.toBeNull();
    if (!tabElement) {
      return;
    }
    const trigger = tabTooltipTrigger(tabElement);
    const closeButton = tabElement.querySelector(".dv-default-tab-action");
    expect(closeButton).not.toBeNull();
    expect(closeButton && trigger.contains(closeButton)).toBe(false);
    expect(trigger).toHaveClass("h-full", "self-stretch");
    act(() => {
      fireEvent.pointerMove(trigger, {
        pointerType: "mouse",
      });
    });
    advanceTooltipDelay(PANEL_TAB_TOOLTIP_DELAY_MS - 1);
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

  it("renders running tab state as a soft-shimmer top-edge a11y anchor", () => {
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

    const { container } = render(
      <PanelTabHeader {...createHeaderProps("terminal", "Terminal")} />
    );

    const indicator = container.querySelector(
      "[data-panel-tab-state-indicator]"
    );
    expect(container.querySelector(".dv-default-tab")).toHaveAttribute(
      "data-tab-status",
      "running"
    );
    expect(indicator).toHaveAttribute("data-tab-status", "running");
    expect(indicator).toHaveAttribute("aria-label", "Running");
    // dockview 视觉在外层 ::before；内层只留 a11y 锚点
    expect(indicator).toHaveClass(
      "pier-tab-running-bar",
      "absolute",
      "overflow-hidden"
    );
    expect(indicator).not.toHaveClass("pier-tab-running-bar--menu");
    expect(indicator?.querySelector("[data-panel-tab-state-icon]")).toBeNull();
    expect(
      indicator?.querySelector("[data-panel-tab-running-segment]")
    ).toBeNull();
    expect(
      indicator?.querySelector("[data-panel-tab-running-track]")
    ).toBeNull();
  });

  it.each([
    ["succeeded", "Succeeded", "succeeded", "text-status-success-fg"],
    ["failed", "Failed 1", "failed", "text-status-danger-fg"],
    ["waiting", "Waiting for input", "waiting", "text-status-warning-fg"],
    ["blocked", "Blocked", "blocked", "text-status-warning-fg"],
    ["cancelled", "Cancelled", "cancelled", "text-status-warning-fg"],
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
    expect(
      indicator?.querySelector("[data-panel-tab-running-ping]")
    ).toBeNull();
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
    const trigger = tabTooltipTrigger(tabElement);

    act(() => {
      fireEvent.pointerMove(trigger, {
        pointerType: "mouse",
      });
    });
    advanceTooltipDelay(PANEL_TAB_TOOLTIP_DELAY_MS);
    expect(screen.getByRole("tooltip")).toHaveTextContent("dev");

    act(() => {
      fireEvent.pointerOut(trigger, {
        pointerType: "mouse",
        relatedTarget: document.body,
      });
      fireEvent.pointerLeave(trigger, {
        pointerType: "mouse",
        relatedTarget: document.body,
      });
    });

    expect(screen.queryByRole("tooltip")).toBeNull();
  });

  it("does not open tab tooltips from keyboard or pointer-driven focus", () => {
    vi.useFakeTimers();
    usePanelDescriptorStore.setState({
      activeId: "terminal-1",
      descriptors: {
        "terminal-1": {
          display: { short: "one" },
          tab: { title: "one", tooltip: { title: "one" } },
        },
        "terminal-2": {
          display: { short: "two" },
          tab: { title: "two", tooltip: { title: "two" } },
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
      </>
    );
    const [firstTab, secondTab] = container.querySelectorAll(".dv-default-tab");
    expect(firstTab).toBeDefined();
    expect(secondTab).toBeDefined();
    if (!(firstTab && secondTab)) {
      return;
    }

    // 键盘/程序化 focus 不得即时开 tip（快捷键切 tab 主回归）。
    fireEvent.focus(firstTab);
    expect(screen.queryByRole("tooltip")).toBeNull();

    // 指针切 tab 后的 focus handoff 也不得 reopen。
    const secondTrigger = tabTooltipTrigger(secondTab);
    fireEvent.pointerDown(secondTab, { button: 0, detail: 1 });
    fireEvent.pointerMove(secondTrigger, { pointerType: "mouse" });
    fireEvent.pointerLeave(secondTrigger, { pointerType: "mouse" });
    fireEvent.focus(firstTab);
    expect(screen.queryByRole("tooltip")).toBeNull();
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
    const firstTrigger = tabTooltipTrigger(firstTab);
    const secondTrigger = tabTooltipTrigger(secondTab);
    const thirdTrigger = tabTooltipTrigger(thirdTab);

    act(() => {
      fireEvent.pointerMove(firstTrigger, {
        pointerType: "mouse",
      });
    });
    advanceTooltipDelay(PANEL_TAB_TOOLTIP_DELAY_MS);
    expect(screen.getByRole("tooltip")).toHaveTextContent("one");

    act(() => {
      fireEvent.pointerOut(firstTrigger, {
        pointerType: "mouse",
        relatedTarget: secondTrigger,
      });
      fireEvent.pointerLeave(firstTrigger, {
        pointerType: "mouse",
        relatedTarget: secondTrigger,
      });
      fireEvent.pointerMove(secondTrigger, {
        pointerType: "mouse",
      });
    });

    expect(screen.queryByRole("tooltip")).toBeNull();
    advanceTooltipDelay(PANEL_TAB_TOOLTIP_DELAY_MS - 1);
    expect(screen.queryByRole("tooltip")).toBeNull();
    advanceTooltipDelay(1);
    expect(screen.getByRole("tooltip")).toHaveTextContent("two");

    act(() => {
      fireEvent.pointerOut(secondTrigger, {
        pointerType: "mouse",
        relatedTarget: thirdTrigger,
      });
      fireEvent.pointerLeave(secondTrigger, {
        pointerType: "mouse",
        relatedTarget: thirdTrigger,
      });
    });

    act(() => {
      fireEvent.pointerMove(thirdTrigger, {
        pointerType: "mouse",
      });
    });

    expect(screen.queryByRole("tooltip")).toBeNull();
    advanceTooltipDelay(PANEL_TAB_TOOLTIP_DELAY_MS - 1);
    expect(screen.queryByRole("tooltip")).toBeNull();
    advanceTooltipDelay(1);
    expect(screen.getByRole("tooltip")).toHaveTextContent("three");
  });

  it("skips open delay when sweeping tabs under workspace skipDelayDuration", () => {
    vi.useFakeTimers();
    usePanelDescriptorStore.setState({
      activeId: null,
      descriptors: {
        "terminal-1": {
          display: { short: "one" },
          tab: {
            title: "one",
            tooltip: { title: "one" },
          },
        },
        "terminal-2": {
          display: { short: "two" },
          tab: {
            title: "two",
            tooltip: { title: "two" },
          },
        },
      },
    });

    const { container } = renderBase(
      <TooltipProvider skipDelayDuration={PANEL_TAB_TOOLTIP_SKIP_DELAY_MS}>
        <PanelTabHeader {...createHeaderProps("terminal", "Terminal")} />
        <PanelTabHeader
          {...createHeaderProps(
            "terminal",
            "Terminal",
            undefined,
            "terminal-2"
          )}
        />
      </TooltipProvider>
    );
    const [firstTab, secondTab] = Array.from(
      container.querySelectorAll(".dv-default-tab")
    );
    expect(firstTab).toBeDefined();
    expect(secondTab).toBeDefined();
    if (!(firstTab && secondTab)) {
      return;
    }
    const firstTrigger = tabTooltipTrigger(firstTab);
    const secondTrigger = tabTooltipTrigger(secondTab);

    act(() => {
      fireEvent.pointerMove(firstTrigger, { pointerType: "mouse" });
    });
    advanceTooltipDelay(PANEL_TAB_TOOLTIP_DELAY_MS);
    expect(screen.getByRole("tooltip")).toHaveTextContent("one");

    act(() => {
      fireEvent.pointerOut(firstTrigger, {
        pointerType: "mouse",
        relatedTarget: secondTrigger,
      });
      fireEvent.pointerLeave(firstTrigger, {
        pointerType: "mouse",
        relatedTarget: secondTrigger,
      });
      fireEvent.pointerMove(secondTrigger, { pointerType: "mouse" });
    });

    // Within skip-delay window: second tab tooltip should open without full delay.
    advanceTooltipDelay(1);
    expect(screen.getByRole("tooltip")).toHaveTextContent("two");
  });

  it("does not attach native title on dirty dot or status indicator", () => {
    usePanelDescriptorStore.setState({
      activeId: null,
      descriptors: {
        "file-1": {
          display: { short: "draft.ts" },
          tab: {
            state: { label: "Running", status: "running" },
            title: "draft.ts",
          },
        },
      },
    });
    const { container } = render(
      <PanelTabHeader
        {...createHeaderProps(
          "pier.files.filePanel",
          "draft.ts",
          undefined,
          "file-1",
          { dirty: true, pinned: true }
        )}
      />
    );
    const dirty = container.querySelector("[data-pier-tab-dirty='true']");
    const indicator = container.querySelector(
      "[data-panel-tab-state-indicator]"
    );
    expect(dirty).not.toBeNull();
    expect(dirty).not.toHaveAttribute("title");
    expect(indicator).not.toBeNull();
    expect(indicator).not.toHaveAttribute("title");
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

  it("renders a file-tree icon for namespaced file tab chrome", () => {
    usePanelDescriptorStore.setState({
      activeId: null,
      descriptors: {
        "file-1": {
          display: { short: "file.ts" },
          tab: {
            icon: { id: "pier.file:file.ts" },
            title: "file.ts",
          },
        },
      },
    });

    const { container } = render(
      <PanelTabHeader
        {...createHeaderProps(
          "pier.files.filePanel",
          "file.ts",
          undefined,
          "file-1"
        )}
      />
    );

    const icon = container.querySelector(
      '[data-panel-tab-icon="pier.file:file.ts"]'
    );
    expect(icon).toHaveAttribute("data-icon-token", "typescript");
    expect(icon?.querySelector("use")).toHaveAttribute(
      "href",
      "#file-tree-builtin-typescript"
    );
  });

  it("does not render an icon for unknown panel kits", () => {
    const { container } = render(
      <PanelTabHeader {...createHeaderProps("unknown", "Unknown")} />
    );

    expect(container.querySelector("[data-panel-tab-icon]")).toBeNull();
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
    const { container: fileContainer } = render(
      <PanelTabHeader {...fileProps} />
    );

    const fileTab = fileContainer.querySelector(
      '[data-panel-tab-id="pier.files.filePanel:disk:abc"]'
    );
    expect(fileTab).not.toBeNull();
    fireEvent.pointerDown(fileTab as HTMLElement, { button: 0, detail: 2 });
    fireEvent.doubleClick(fileTab as HTMLElement);

    expect(fileUpdateParameters).toHaveBeenCalledTimes(1);
    expect(fileUpdateParameters).toHaveBeenCalledWith({ pinned: true });
  });

  it("marks file tabs with data-pier-tab-kind=file for mono medium styling", () => {
    const { container } = render(
      <PanelTabHeader
        {...createHeaderProps(
          "pier.files.filePanel",
          "README.md",
          undefined,
          "pier.files.filePanel:disk:kind"
        )}
      />
    );

    const tab = container.querySelector(
      '[data-panel-tab-id="pier.files.filePanel:disk:kind"]'
    );
    expect(tab).toHaveAttribute("data-pier-tab-kind", "file");
    expect(
      container.querySelector(".dv-default-tab-content")
    ).toHaveTextContent("README.md");
  });

  it("renders review git-line-delta trailing next to the title without baking it into title", () => {
    usePanelDescriptorStore.setState({
      activeId: null,
      descriptors: {
        "pier.git.changes:1": {
          display: { short: "pier" },
          tab: {
            title: "pier",
            trailing: {
              deletions: 3,
              insertions: 12,
              kind: "git-line-delta",
            },
          },
        },
      },
    });

    const { container } = render(
      <PanelTabHeader
        {...createHeaderProps(
          "pier.git.changes",
          "pier",
          undefined,
          "pier.git.changes:1"
        )}
      />
    );

    expect(
      container.querySelector(".dv-default-tab-content")
    ).toHaveTextContent("pier");
    expect(
      container.querySelector('[data-pier-tab-trailing="git-line-delta"]')
    ).not.toBeNull();
    expect(
      container.querySelector('[data-git-delta="insertions"]')
    ).toHaveTextContent("+12");
    expect(
      container.querySelector('[data-git-delta="deletions"]')
    ).toHaveTextContent("−3");
    expect(container.querySelector(".dv-default-tab")).toHaveAttribute(
      "data-pier-tab-kind",
      "review"
    );
    expect(container.querySelector(".dv-default-tab")).toHaveAttribute(
      "aria-label",
      "pier, +12 −3"
    );
  });

  it("shows a frontmost absolutely positioned active-task presence dot when RC-scoped runs are active", () => {
    useTaskRunsStore.setState({
      error: null,
      initialized: true,
      snapshot: {
        runs: {
          "run-bg": {
            mode: "background",
            nodes: {
              dev: {
                label: "dev",
                panelId: "background-task:run-bg:dev",
                status: "running",
                taskId: "dev",
              },
            },
            originPanelId: "terminal-1",
            projectRootPath: "/repo",
            rootTaskId: "dev",
            runId: "run-bg",
            startedAt: 1,
            status: "running",
            updatedAt: 2,
          },
        },
        version: 1,
      },
    });

    const { container } = render(
      <PanelTabHeader {...createHeaderProps("terminal", "Terminal")} />
    );

    const tab = container.querySelector(".dv-default-tab");
    const title = container.querySelector(".dv-default-tab-content");
    const dot = container.querySelector('[data-pier-tab-active-task="true"]');
    expect(tab).not.toBeNull();
    expect(tab).toHaveClass("relative");
    // Root flag drives left padding gutter so the absolute dot does not
    // overlap ⌘ index / icon / title.
    expect(tab).toHaveAttribute("data-pier-tab-has-active-task", "true");
    expect(title).not.toBeNull();
    expect(dot).not.toBeNull();
    expect(title?.contains(dot)).toBe(false);
    expect(dot).toHaveClass(
      "pointer-events-none",
      "absolute",
      "top-1/2",
      "left-1",
      "-translate-y-1/2",
      "size-1.5",
      "rounded-full",
      "bg-status-info-fg"
    );
    expect(dot).toHaveAttribute("aria-label", "Task running");
    expect(dot).toHaveAttribute("role", "status");
    // Frontmost in DOM among tab children (before icon/title).
    expect(tab?.firstElementChild).toBe(dot);
  });

  it("hides the active-task presence dot when no related run is active", () => {
    useTaskRunsStore.setState({
      error: null,
      initialized: true,
      snapshot: {
        runs: {
          "run-done": {
            mode: "background",
            nodes: {
              dev: {
                label: "dev",
                panelId: "background-task:run-done:dev",
                status: "succeeded",
                taskId: "dev",
              },
            },
            originPanelId: "terminal-1",
            projectRootPath: "/repo",
            rootTaskId: "dev",
            runId: "run-done",
            startedAt: 1,
            status: "succeeded",
            updatedAt: 2,
          },
        },
        version: 1,
      },
    });

    const { container } = render(
      <PanelTabHeader {...createHeaderProps("terminal", "Terminal")} />
    );

    expect(
      container.querySelector('[data-pier-tab-active-task="true"]')
    ).toBeNull();
    expect(
      container.querySelector('[data-pier-tab-has-active-task="true"]')
    ).toBeNull();
  });

  it("pins a preview through the real dockview parameter channel", async () => {
    const panelId = "pier.files.filePanel:disk:real-dockview";
    let readyApi: DockviewReadyEvent["api"] | null = null;
    const { container } = render(
      <div style={{ height: 240, width: 640 }}>
        <DockviewReact
          components={{
            "pier.files.filePanel": () => <div data-testid="real-file-panel" />,
          }}
          defaultTabComponent={PanelTabHeader}
          onReady={(event) => {
            readyApi = event.api;
            event.api.addPanel({
              component: "pier.files.filePanel",
              id: panelId,
              params: {
                pinned: false,
                source: "file:///workspace/README.md",
              },
              title: "README.md",
            });
          }}
        />
      </div>
    );

    const tab = await waitFor(() => {
      const element = container.querySelector(
        `[data-panel-tab-id="${panelId}"]`
      );
      expect(element).toBeInstanceOf(HTMLElement);
      return element as HTMLElement;
    });
    expect(tab).toHaveAttribute("data-pier-tab-preview", "true");

    fireEvent.doubleClick(tab);

    await waitFor(() => {
      expect(readyApi?.getPanel(panelId)?.params).toMatchObject({
        pinned: true,
        source: "file:///workspace/README.md",
      });
      expect(tab).not.toHaveAttribute("data-pier-tab-preview");
    });
  });
});
