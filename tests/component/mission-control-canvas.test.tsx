import { act, fireEvent, render, screen, within } from "@testing-library/react";
import type { ReactElement } from "react";
import type { GridLayoutProps, LayoutItem } from "react-grid-layout";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MissionControlPanel } from "@/panel-kits/mission-control/mission-control-panel.tsx";
import { useAppDialogStore } from "@/stores/app-dialog.store.ts";
import {
  installMissionControlTestHarness,
  makeProps,
} from "./mission-control-test-harness.ts";

const gridLayoutCapture = vi.hoisted(() => ({
  current: null as GridLayoutProps | null,
}));
vi.mock("react-grid-layout", async (importOriginal) => {
  const actual = (await importOriginal()) as object;
  return {
    ...actual,
    default(props: GridLayoutProps) {
      gridLayoutCapture.current = props;
      return props.children as ReactElement;
    },
  };
});

vi.mock("sonner", () => ({
  toast: { error: vi.fn(), success: vi.fn() },
}));

class TestResizeObserver implements ResizeObserver {
  static latest: TestResizeObserver | null = null;
  readonly disconnect = vi.fn();
  readonly observe = vi.fn();
  readonly unobserve = vi.fn();
  private readonly callback: ResizeObserverCallback;

  constructor(callback: ResizeObserverCallback) {
    this.callback = callback;
    TestResizeObserver.latest = this;
  }

  emit(): void {
    const target = this.observe.mock.calls[0]?.[0] as Element;
    this.callback([{ target } as ResizeObserverEntry], this);
  }
}

const dimensions = { height: 624, width: 824 };

function capturedGrid(): GridLayoutProps {
  expect(gridLayoutCapture.current).not.toBeNull();
  return gridLayoutCapture.current!;
}

function callGridCallback(
  callback:
    | GridLayoutProps["onDragStart"]
    | GridLayoutProps["onDrag"]
    | GridLayoutProps["onDragStop"]
    | GridLayoutProps["onResize"]
    | GridLayoutProps["onResizeStop"],
  oldItem: LayoutItem,
  activeItem: LayoutItem
): void {
  const invoke = callback as unknown as (...args: unknown[]) => void;
  invoke(capturedGrid().layout ?? [], oldItem, activeItem);
}

installMissionControlTestHarness();

beforeEach(() => {
  gridLayoutCapture.current = null;
  dimensions.height = 624;
  dimensions.width = 824;
  vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockImplementation(
    () => dimensions.width
  );
  vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockImplementation(
    () => dimensions.height
  );
  vi.stubGlobal("ResizeObserver", TestResizeObserver);
});

afterEach(() => vi.unstubAllGlobals());

describe("Mission Control responsive grid integration", () => {
  it("derives fixed grid rhythm and Z-order coordinates from array order", () => {
    render(
      <MissionControlPanel
        {...makeProps({
          layoutVersion: 3,
          widgets: [
            { h: 2, id: "core.activity-overview", w: 4 },
            { h: 4, id: "core.system-resources", w: 4 },
            { h: 2, id: "core.custom-card", w: 4 },
          ],
        })}
      />
    );
    const grid = capturedGrid();

    expect(grid.gridConfig).toMatchObject({
      cols: 8,
      containerPadding: [0, 0],
      margin: [12, 12],
      rowHeight: 88,
    });
    expect(
      grid.layout?.map(({ h, i, w, x, y }) => ({ h, i, w, x, y }))
    ).toEqual([
      { h: 2, i: "core.activity-overview", w: 4, x: 0, y: 0 },
      { h: 4, i: "core.system-resources", w: 4, x: 4, y: 0 },
      { h: 2, i: "core.custom-card", w: 4, x: 0, y: 4 },
      { h: 1, i: "mission-control-add", w: 2, x: 4, y: 4 },
    ]);
  });

  it("reflows on width changes without persisting transient geometry", async () => {
    const updateParameters = vi.fn();
    render(
      <MissionControlPanel
        {...makeProps(
          {
            layoutVersion: 3,
            widgets: [{ h: 3, id: "core.activity-overview", w: 8 }],
          },
          updateParameters
        )}
      />
    );
    expect(capturedGrid().gridConfig?.cols).toBe(8);
    expect(capturedGrid().layout?.[0]).toMatchObject({ w: 8 });

    dimensions.width = 424;
    act(() => TestResizeObserver.latest?.emit());

    await vi.waitFor(() => {
      expect(capturedGrid().gridConfig?.cols).toBe(4);
    });
    expect(capturedGrid().layout?.[0]).toMatchObject({ w: 4 });
    expect(updateParameters).not.toHaveBeenCalled();

    dimensions.width = 824;
    act(() => TestResizeObserver.latest?.emit());
    await vi.waitFor(() => {
      expect(capturedGrid().layout?.[0]).toMatchObject({ w: 8 });
    });
  });

  it("persists pointer dragging as order only", () => {
    const updateParameters = vi.fn();
    render(
      <MissionControlPanel
        {...makeProps(
          {
            layoutVersion: 3,
            widgets: [
              { h: 3, id: "core.activity-overview", w: 4 },
              { h: 3, id: "core.system-resources", w: 4 },
              { h: 3, id: "core.custom-card", w: 4 },
            ],
          },
          updateParameters
        )}
      />
    );
    const oldItem = capturedGrid().layout?.[0] as LayoutItem;

    callGridCallback(capturedGrid().onDragStop, oldItem, {
      ...oldItem,
      x: 0,
      y: 3,
    });

    expect(updateParameters).toHaveBeenCalledWith({
      layoutVersion: 3,
      widgets: [
        { h: 3, id: "core.system-resources", w: 4 },
        { h: 3, id: "core.custom-card", w: 4 },
        { h: 3, id: "core.activity-overview", w: 4 },
      ],
    });
  });

  it("keeps repeated cross-slot drag previews under the ordered solver", () => {
    const updateParameters = vi.fn();
    render(
      <MissionControlPanel
        {...makeProps(
          {
            layoutVersion: 3,
            widgets: [
              { h: 3, id: "core.activity-overview", w: 4 },
              { h: 3, id: "core.system-resources", w: 4 },
              { h: 3, id: "core.custom-card", w: 4 },
            ],
          },
          updateParameters
        )}
      />
    );

    expect(capturedGrid().compactor).toMatchObject({
      allowOverlap: true,
      type: null,
    });
    const initialLayout = capturedGrid().layout?.map(({ h, i, w, x, y }) => ({
      h,
      i,
      w,
      x,
      y,
    }));
    const customItem = capturedGrid().layout?.find(
      (item) => item.i === "core.custom-card"
    ) as LayoutItem;

    act(() => {
      callGridCallback(capturedGrid().onDrag, customItem, {
        ...customItem,
        x: 0,
        y: 0,
      });
    });
    expect(
      screen.getByTestId("mission-control-widget-core.activity-overview")
        .parentElement?.style.transform
    ).toContain("translate3d");
    expect(
      capturedGrid().layout?.map(({ h, i, w, x, y }) => ({ h, i, w, x, y }))
    ).toEqual(initialLayout);

    act(() => {
      callGridCallback(capturedGrid().onDrag, customItem, {
        ...customItem,
        x: 4,
        y: 0,
      });
    });
    expect(
      screen.getByTestId("mission-control-widget-core.system-resources")
        .parentElement?.style.transform
    ).toContain("translate3d");
    expect(
      capturedGrid().layout?.map(({ h, i, w, x, y }) => ({ h, i, w, x, y }))
    ).toEqual(initialLayout);

    act(() => {
      callGridCallback(capturedGrid().onDragStop, customItem, {
        ...customItem,
        x: 4,
        y: 0,
      });
    });
    expect(updateParameters).toHaveBeenLastCalledWith({
      layoutVersion: 3,
      widgets: [
        { h: 3, id: "core.activity-overview", w: 4 },
        { h: 3, id: "core.custom-card", w: 4 },
        { h: 3, id: "core.system-resources", w: 4 },
      ],
    });
    expect(capturedGrid().layout?.map(({ i, x, y }) => ({ i, x, y }))).toEqual([
      { i: "core.activity-overview", x: 0, y: 0 },
      { i: "core.custom-card", x: 4, y: 0 },
      { i: "core.system-resources", x: 0, y: 3 },
      { i: "mission-control-add", x: 4, y: 3 },
    ]);
  });

  it("realigns RGL transient coordinates when a drag keeps the same order", () => {
    const updateParameters = vi.fn();
    render(
      <MissionControlPanel
        {...makeProps(
          {
            layoutVersion: 3,
            widgets: [
              { h: 3, id: "core.activity-overview", w: 4 },
              { h: 3, id: "core.system-resources", w: 4 },
              { h: 3, id: "core.custom-card", w: 4 },
            ],
          },
          updateParameters
        )}
      />
    );
    const canonical = capturedGrid().layout ?? [];
    const custom = canonical.find(
      (item) => item.i === "core.custom-card"
    ) as LayoutItem;
    const transient = canonical.map((item) =>
      item.i === custom.i ? { ...item, moved: true, x: 1 } : { ...item }
    );
    const invoke = capturedGrid().onDragStop as unknown as (
      ...args: unknown[]
    ) => void;

    act(() => {
      invoke(
        transient,
        custom,
        { ...custom, x: 1 },
        null,
        new Event("mouseup"),
        null
      );
    });

    expect(transient.find((item) => item.i === custom.i)).toMatchObject({
      moved: false,
      x: 0,
      y: 3,
    });
    expect(updateParameters).not.toHaveBeenCalled();
  });

  it("persists pointer resizing as preferred w/h only", () => {
    const updateParameters = vi.fn();
    render(
      <MissionControlPanel
        {...makeProps(
          {
            layoutVersion: 3,
            widgets: [{ h: 3, id: "core.activity-overview", w: 4 }],
          },
          updateParameters
        )}
      />
    );
    const oldItem = capturedGrid().layout?.[0] as LayoutItem;

    callGridCallback(capturedGrid().onResizeStop, oldItem, {
      ...oldItem,
      h: 4,
      w: 5,
    });

    expect(updateParameters).toHaveBeenCalledWith({
      layoutVersion: 3,
      widgets: [{ h: 4, id: "core.activity-overview", w: 5 }],
    });
  });

  it("deleting the middle widget immediately closes its visual gap", async () => {
    const updateParameters = vi.fn();
    render(
      <MissionControlPanel
        {...makeProps(
          {
            layoutVersion: 3,
            widgets: [
              { h: 3, id: "core.activity-overview", w: 4 },
              { h: 3, id: "core.system-resources", w: 4 },
              { h: 3, id: "core.custom-card", w: 4 },
            ],
          },
          updateParameters
        )}
      />
    );
    const systemItem = capturedGrid().layout?.find(
      (item) => item.i === "core.system-resources"
    ) as LayoutItem;
    // 模拟调整尺寸过程中直接打开菜单删除，RGL 不会送出 resizeStop。
    callGridCallback(capturedGrid().onResize, systemItem, {
      ...systemItem,
      h: 6,
    });
    const systemCard = screen.getByTestId(
      "mission-control-widget-core.system-resources"
    );
    fireEvent.pointerDown(
      within(systemCard).getByTestId("mission-control-widget-menu-trigger"),
      { button: 0, ctrlKey: false, pointerType: "mouse" }
    );
    fireEvent.click(
      await screen.findByTestId("mission-control-widget-menu-remove")
    );
    const dialog = useAppDialogStore.getState().current;
    if (dialog?.kind === "confirm") {
      await act(async () => dialog.resolve(true));
    }

    await vi.waitFor(() => {
      expect(
        capturedGrid().layout?.some(
          (item) => item.i === "core.system-resources"
        )
      ).toBe(false);
      expect(
        capturedGrid().layout?.find((item) => item.i === "core.custom-card")
      ).toMatchObject({ x: 4, y: 0 });
    });
    expect(updateParameters).toHaveBeenCalledWith({
      layoutVersion: 3,
      widgets: [
        { h: 3, id: "core.activity-overview", w: 4 },
        { h: 3, id: "core.custom-card", w: 4 },
      ],
    });
  });
});
