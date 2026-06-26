import { act, render, screen } from "@testing-library/react";
import { DockviewReact, type DockviewReadyEvent } from "dockview-react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { WorkspaceHost } from "@/components/workspace/workspace-host.tsx";
import { useWorkspaceStore } from "@/stores/workspace.store.ts";

vi.mock("dockview-react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("dockview-react")>();
  return {
    ...actual,
    DockviewReact: vi.fn((props) => (
      <div
        data-disable-tabs-overflow-list={String(props.disableTabsOverflowList)}
        data-left-header-actions={
          props.leftHeaderActionsComponent?.name ?? "none"
        }
        data-testid="dockview"
      />
    )),
  };
});

describe("WorkspaceHost", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useWorkspaceStore.setState({ api: null });
  });

  it("disables dockview overflow and uses the workspace shadcn header actions", () => {
    render(<WorkspaceHost />);

    expect(screen.getByTestId("dockview")).toHaveAttribute(
      "data-disable-tabs-overflow-list",
      "true"
    );
    expect(screen.getByTestId("dockview")).toHaveAttribute(
      "data-left-header-actions",
      "WorkspaceHeaderActions"
    );
    expect(DockviewReact).toHaveBeenCalled();
  });

  it("creates a terminal panel when main sends the native menu request", () => {
    const bridge: { listener?: () => void } = {};
    const addPanel = vi.fn();
    const onNewTerminalRequest = vi.fn((cb: () => void) => {
      bridge.listener = cb;
      return vi.fn();
    });
    Object.defineProperty(window, "pier", {
      configurable: true,
      value: {
        getWindowContext: vi.fn(() => new Promise(() => undefined)),
        readyToShow: vi.fn(),
        rendererCommand: {
          onCommand: vi.fn(),
          resolve: vi.fn(),
        },
        terminal: {
          onFocusRequest: vi.fn(),
          reconcile: vi.fn(),
          setActivePanelKind: vi.fn(),
        },
        workspace: {
          clearLayout: vi.fn(),
          loadLayout: vi.fn(),
          onNewTerminalRequest,
          saveLayout: vi.fn(),
        },
      } as never,
    });

    render(<WorkspaceHost />);
    const props = vi.mocked(DockviewReact).mock.calls.at(-1)?.[0];
    if (!props) {
      throw new Error("DockviewReact props missing");
    }
    const api = {
      activeGroup: null,
      activePanel: null,
      addPanel,
      onDidActivePanelChange: vi.fn(),
      onDidLayoutChange: vi.fn(),
      onDidMaximizedGroupChange: vi.fn(),
      panels: [],
      toJSON: vi.fn(() => ({ grid: { root: undefined } })),
      totalPanels: 0,
    } as unknown as DockviewReadyEvent["api"];

    act(() => {
      props.onReady?.({ api } as DockviewReadyEvent);
      bridge.listener?.();
    });

    expect(onNewTerminalRequest).toHaveBeenCalledOnce();
    expect(addPanel).toHaveBeenCalledWith(
      expect.objectContaining({
        component: "terminal",
        title: "Terminal",
      })
    );
  });
});
