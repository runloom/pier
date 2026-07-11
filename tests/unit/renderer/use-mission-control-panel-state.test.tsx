import { act } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { findWidgetDeclaration } from "@/panel-kits/mission-control/mission-control-panel-state-normalization.ts";
import {
  entry,
  params,
  renderState,
  SQUARE_WIDGET_ID,
  squareWidgetPlugins,
  widget,
  widgetIds,
} from "./mission-control-panel-state-test-harness.ts";

describe("useMissionControlPanelState v3", () => {
  it("reads legacy geometry without writing on mount", () => {
    const hook = renderState({
      locked: true,
      placementDirection: "vertical",
      widgets: [
        { h: 3, id: "b", w: 4, x: 4, y: 0 },
        { h: 3, id: "a", w: 4, x: 0, y: 0 },
      ],
    });

    expect(hook.result.current.optimisticParams).toEqual(
      params([entry("a"), entry("b")])
    );
    expect(hook.updateParameters).not.toHaveBeenCalled();
  });

  it("adds at the end and persists only v3 semantic fields", () => {
    const hook = renderState(params([]));

    act(() => hook.result.current.handleAdd("core.activity-overview"));

    expect(hook.snapshots()).toEqual([
      {
        layoutVersion: 3,
        widgets: [
          {
            h: 3,
            id: "core.activity-overview",
            w: 4,
            widgetId: "core.activity-overview",
          },
        ],
      },
    ]);
  });

  it("deleting immediately closes the gap through the remaining array order", () => {
    const hook = renderState(params([entry("a"), entry("b"), entry("c")]));

    act(() => hook.result.current.handleRemove("b"));

    expect(widgetIds(hook.result.current.optimisticParams)).toEqual(["a", "c"]);
    expect(widgetIds(hook.snapshots().at(-1)!)).toEqual(["a", "c"]);
  });

  it("reorders instances and preserves their preferred sizes", () => {
    const hook = renderState(
      params([entry("a", 2, 3), entry("b", 5, 4), entry("c", 3, 2)])
    );

    act(() => hook.result.current.handleReorder("c", 0));

    expect(widgetIds(hook.snapshots().at(-1)!)).toEqual(["c", "a", "b"]);
    expect(widget(hook.snapshots().at(-1)!, "c")).toMatchObject({
      h: 2,
      w: 3,
    });
  });

  it("clamps a resize to the widget declaration and persists the preference", () => {
    const hook = renderState(
      params([entry("instance", 4, 4, { widgetId: SQUARE_WIDGET_ID })]),
      squareWidgetPlugins()
    );

    act(() => hook.result.current.handleResize("instance", { h: 12, w: 1 }));

    expect(widget(hook.snapshots().at(-1)!, "instance")).toMatchObject({
      h: 6,
      w: 3,
    });
  });

  it("keeps disabled-plugin resize constraints available to rendering", () => {
    const plugins = squareWidgetPlugins();
    const disabledPlugins = plugins.map((plugin) => ({
      ...plugin,
      runtime: { ...plugin.runtime, enabled: false },
    }));

    expect(
      findWidgetDeclaration(SQUARE_WIDGET_ID, disabledPlugins)
    ).toMatchObject({
      maxSize: { h: 6, w: 6 },
      minSize: { h: 3, w: 3 },
    });
  });

  it("duplicates a multi-instance widget at the end with cloned params", () => {
    vi.stubGlobal("crypto", { randomUUID: () => "copy" });
    const hook = renderState(
      params([
        entry("source", 4, 4, {
          params: { label: "source" },
          widgetId: SQUARE_WIDGET_ID,
        }),
      ]),
      squareWidgetPlugins()
    );

    act(() => hook.result.current.handleDuplicate("source"));

    expect(hook.snapshots().at(-1)!.widgets).toEqual([
      expect.objectContaining({ id: "source" }),
      expect.objectContaining({
        id: "copy",
        params: { label: "source" },
        widgetId: SQUARE_WIDGET_ID,
      }),
    ]);
    vi.unstubAllGlobals();
  });

  it("refresh tokens change without persisting panel params", () => {
    const hook = renderState(params([entry("a"), entry("b")]));

    act(() => hook.result.current.refreshOne("a"));
    act(() => hook.result.current.refreshAll());

    expect(hook.result.current.refreshTokens).toEqual({ a: 2, b: 1 });
    expect(hook.updateParameters).not.toHaveBeenCalled();
  });

  it("keeps the latest optimistic order when an older local echo arrives", () => {
    const initial = params([entry("a"), entry("b"), entry("c")]);
    const hook = renderState(initial);

    act(() => hook.result.current.handleReorder("c", 0));
    const older = hook.snapshots().at(-1)!;
    act(() => hook.result.current.handleReorder("b", 0));
    const latest = hook.snapshots().at(-1)!;

    hook.rerender({ api: hook.api, plugins: [], value: older });
    expect(widgetIds(hook.result.current.optimisticParams)).toEqual(
      widgetIds(latest)
    );
  });
});
