import { fireEvent, render, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  popupContextMenuAt,
  useContextMenu,
} from "@/lib/context-menu/use-menu.ts";
import { useWorkspaceStore } from "@/stores/workspace.store.ts";
import { useZoomStore } from "@/stores/zoom.store.ts";

const buildMenuEntriesMock = vi.hoisted(() =>
  vi.fn(() => [{ id: "panel.close", label: "Close", type: "action" }])
);
const suppressTooltipsMock = vi.hoisted(() => vi.fn());
const releaseTooltipSuppressionMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/context-menu/build-entries.ts", () => ({
  buildMenuEntries: buildMenuEntriesMock,
}));

vi.mock("@pier/ui/tooltip.tsx", () => ({
  suppressTooltips: suppressTooltipsMock,
  releaseTooltipSuppression: releaseTooltipSuppressionMock,
}));

vi.mock("@/lib/actions/registry.ts", () => ({
  actionRegistry: {
    get: vi.fn(() => null),
  },
}));

function ContextMenuTarget() {
  const onContextMenu = useContextMenu("dockview-tab");
  return (
    <button onContextMenu={onContextMenu} type="button">
      tab
    </button>
  );
}

describe("useContextMenu", () => {
  beforeEach(() => {
    buildMenuEntriesMock.mockClear();
    suppressTooltipsMock.mockClear();
    releaseTooltipSuppressionMock.mockClear();
    useZoomStore.setState({ windowZoomLevel: 0 });
    useWorkspaceStore.setState({ api: null });
    Object.defineProperty(window, "pier", {
      configurable: true,
      value: {
        menu: {
          popup: vi.fn(async () => ({ actionId: null })),
        },
      },
    });
  });

  it("converts React client coordinates to BrowserWindow coordinates under page zoom", async () => {
    useZoomStore.setState({ windowZoomLevel: 2 });
    const { getByRole } = render(<ContextMenuTarget />);

    fireEvent.contextMenu(getByRole("button"), {
      clientX: 10,
      clientY: 20,
    });

    await waitFor(() => {
      expect(window.pier.menu.popup).toHaveBeenCalledWith(
        [{ id: "panel.close", label: "Close", type: "action" }],
        { x: 14.4, y: 28.8 }
      );
    });
  });

  it("suppresses tooltips for the native menu popup lifetime", async () => {
    const { getByRole } = render(<ContextMenuTarget />);

    fireEvent.contextMenu(getByRole("button"), {
      clientX: 10,
      clientY: 20,
    });

    await waitFor(() => {
      expect(window.pier.menu.popup).toHaveBeenCalled();
    });
    expect(suppressTooltipsMock).toHaveBeenCalledTimes(1);
    expect(releaseTooltipSuppressionMock).toHaveBeenCalledTimes(1);
    const suppressOrder = suppressTooltipsMock.mock.invocationCallOrder[0];
    const releaseOrder =
      releaseTooltipSuppressionMock.mock.invocationCallOrder[0];
    expect(typeof suppressOrder).toBe("number");
    expect(typeof releaseOrder).toBe("number");
    if (typeof suppressOrder !== "number" || typeof releaseOrder !== "number") {
      throw new Error("expected invocation call order");
    }
    expect(suppressOrder).toBeLessThan(releaseOrder);
  });

  it("does not setActive when opening a dockview-tab menu with sourcePanelId", async () => {
    const setActive = vi.fn();
    useWorkspaceStore.setState({
      api: {
        panels: [
          {
            api: { setActive },
            id: "terminal-inactive",
            view: { contentComponent: "terminal" },
          },
        ],
      } as never,
    });

    await popupContextMenuAt(
      "dockview-tab",
      { x: 1, y: 2 },
      { sourcePanelId: "terminal-inactive" }
    );

    expect(setActive).not.toHaveBeenCalled();
    expect(buildMenuEntriesMock).toHaveBeenCalledWith(
      "dockview-tab",
      expect.objectContaining({
        sourcePanelId: "terminal-inactive",
        surface: "dockview-tab",
      })
    );
  });

  it("still setActive for object / unregistered surfaces that pass sourcePanelId", async () => {
    const setActive = vi.fn();
    useWorkspaceStore.setState({
      api: {
        panels: [
          {
            api: { setActive },
            id: "terminal-1",
            view: { contentComponent: "terminal" },
          },
        ],
      } as never,
    });

    await popupContextMenuAt(
      "terminal/status",
      { x: 1, y: 2 },
      { sourcePanelId: "terminal-1" }
    );

    expect(setActive).toHaveBeenCalledOnce();
  });

  it("does not setActive for document surfaces like git/review-diff", async () => {
    const setActive = vi.fn();
    useWorkspaceStore.setState({
      api: {
        panels: [
          {
            api: { setActive },
            id: "git-changes-1",
            view: { contentComponent: "pier.git.changes" },
          },
        ],
      } as never,
    });

    await popupContextMenuAt(
      "git/review-diff",
      { x: 1, y: 2 },
      { sourcePanelId: "git-changes-1" }
    );

    expect(setActive).not.toHaveBeenCalled();
  });

  it("does not setActive for panel/content viewport menus", async () => {
    const setActive = vi.fn();
    useWorkspaceStore.setState({
      api: {
        panels: [
          {
            api: { setActive },
            id: "panel-1",
            view: { contentComponent: "pier.git.changes" },
          },
        ],
      } as never,
    });

    await popupContextMenuAt(
      "panel/content",
      { x: 1, y: 2 },
      { sourcePanelId: "panel-1" }
    );

    expect(setActive).not.toHaveBeenCalled();
  });
});
