import { fireEvent, render, screen } from "@testing-library/react";
import i18next from "i18next";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MissionControlPanel } from "@/panel-kits/mission-control/mission-control-panel.tsx";
import {
  installMissionControlTestHarness,
  makeProps,
  openPanelContextMenu,
} from "./mission-control-test-harness.ts";

vi.mock("sonner", () => ({
  toast: { error: vi.fn(), success: vi.fn() },
}));

const menuPopupMock = vi.fn(async (..._args: unknown[]) => ({
  actionId: null as string | null,
}));

beforeEach(() => {
  menuPopupMock.mockReset();
  menuPopupMock.mockResolvedValue({ actionId: null });
  vi.stubGlobal("pier", {
    ...window.pier,
    menu: { popup: menuPopupMock },
  });
});

afterEach(() => vi.unstubAllGlobals());

installMissionControlTestHarness();

describe("MissionControlPanel responsive ordered grid", () => {
  it("renders the empty state and a persistent add tile", () => {
    render(
      <MissionControlPanel {...makeProps({ layoutVersion: 3, widgets: [] })} />
    );

    expect(screen.getByTestId("mission-control-empty")).toBeInTheDocument();
    expect(
      screen.getByTestId("mission-control-add-widget")
    ).toBeInTheDocument();
  });

  it("always exposes reorder and resize affordances", () => {
    const { container } = render(
      <MissionControlPanel
        {...makeProps({
          layoutVersion: 3,
          widgets: [{ h: 3, id: "core.activity-overview", w: 4 }],
        })}
      />
    );

    expect(
      container.querySelector(".mission-control-widget-drag-handle")
    ).toBeInTheDocument();
    expect(
      container.querySelector(".react-resizable-handle-se")
    ).toBeInTheDocument();
  });

  it("uses a non-horizontal-scrolling viewport and responsive columns", () => {
    const { container } = render(
      <MissionControlPanel
        {...makeProps({
          layoutVersion: 3,
          widgets: [{ h: 3, id: "core.activity-overview", w: 8 }],
        })}
      />
    );

    const viewport = container.querySelector("[data-scrollbar='stable']");
    expect(viewport?.className).toContain("overflow-x-hidden");
    expect(screen.getByTestId("mission-control-grid-wrapper")).toHaveAttribute(
      "data-responsive-cols",
      "8"
    );
  });

  it("keeps widget content on container queries", () => {
    const { container } = render(
      <MissionControlPanel
        {...makeProps({
          layoutVersion: 3,
          widgets: [{ h: 3, id: "core.activity-overview", w: 4 }],
        })}
      />
    );

    expect(
      container.querySelector("[data-slot='card-content']")?.className
    ).toContain("@container");
  });

  it("migrates legacy geometry in memory without writing on mount", () => {
    const updateParameters = vi.fn();
    const { container } = render(
      <MissionControlPanel
        {...makeProps(
          {
            locked: true,
            placementDirection: "vertical",
            widgets: [
              { h: 3, id: "core.system-resources", w: 4, x: 4, y: 0 },
              { h: 3, id: "core.activity-overview", w: 4, x: 0, y: 0 },
            ],
          },
          updateParameters
        )}
      />
    );

    const ids = [
      ...container.querySelectorAll("[data-mission-control-instance-id]"),
    ].map((node) => node.getAttribute("data-mission-control-instance-id"));
    expect(ids).toEqual(["core.activity-overview", "core.system-resources"]);
    expect(updateParameters).not.toHaveBeenCalled();
  });
});

describe("MissionControlPanel native menu", () => {
  it.each([
    ["en", "Add Widget", "Refresh All"],
    ["zh-CN", "添加组件", "全部刷新"],
  ])("%s exposes only automatic-layout-safe global actions", async (locale, addLabel, refreshLabel) => {
    await i18next.changeLanguage(locale);
    render(
      <MissionControlPanel
        {...makeProps({
          layoutVersion: 3,
          widgets: [{ h: 3, id: "core.activity-overview", w: 4 }],
        })}
      />
    );

    openPanelContextMenu();

    await vi.waitFor(() => expect(menuPopupMock).toHaveBeenCalledTimes(1));
    expect(menuPopupMock.mock.calls[0]?.[0]).toEqual([
      {
        id: "pier.missionControl.addWidget",
        label: addLabel,
        type: "action",
      },
      {
        enabled: true,
        id: "pier.missionControl.refreshAll",
        label: refreshLabel,
        type: "action",
      },
    ]);
  });

  it("opens the widget library from the native add action", async () => {
    menuPopupMock.mockResolvedValueOnce({
      actionId: "pier.missionControl.addWidget",
    });
    render(
      <MissionControlPanel {...makeProps({ layoutVersion: 3, widgets: [] })} />
    );

    openPanelContextMenu();

    expect(
      await screen.findByTestId("mission-control-library")
    ).toBeInTheDocument();
  });

  it("opens the same menu through Shift+F10", async () => {
    render(
      <MissionControlPanel {...makeProps({ layoutVersion: 3, widgets: [] })} />
    );
    const grid = screen.getByTestId("mission-control-grid-wrapper");

    fireEvent.keyDown(grid, { key: "F10", shiftKey: true });

    await vi.waitFor(() => expect(menuPopupMock).toHaveBeenCalledTimes(1));
  });
});
