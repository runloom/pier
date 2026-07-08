import {
  type CoreMissionControlWidgetDeclaration,
  HOST_DEFAULT_WIDGET_SIZE,
  HOST_MAX_WIDGET_SIZE,
  HOST_MIN_WIDGET_SIZE,
  MISSION_CONTROL_GRID_COLS,
  missionControlGridSizeSchema,
  missionControlPanelParamsSchema,
  pluginMissionControlWidgetContributionSchema,
} from "@shared/contracts/mission-control.ts";
import { pluginManifestSchema } from "@shared/contracts/plugin.ts";
import { describe, expect, it } from "vitest";

const W_AXIS_PATTERN = /w axis/;
const H_AXIS_PATTERN = /h axis/;

describe("missionControlGridSizeSchema", () => {
  it("accepts valid grid size", () => {
    const result = missionControlGridSizeSchema.parse({ h: 3, w: 4 });
    expect(result).toEqual({ h: 3, w: 4 });
  });

  it("rejects w exceeding MISSION_CONTROL_GRID_COLS", () => {
    expect(() =>
      missionControlGridSizeSchema.parse({
        h: 3,
        w: MISSION_CONTROL_GRID_COLS + 1,
      })
    ).toThrow();
  });

  it("rejects h exceeding 24", () => {
    expect(() => missionControlGridSizeSchema.parse({ h: 25, w: 4 })).toThrow();
  });

  it("rejects non-integer w", () => {
    expect(() =>
      missionControlGridSizeSchema.parse({ h: 3, w: 4.5 })
    ).toThrow();
  });

  it("rejects w < 1", () => {
    expect(() => missionControlGridSizeSchema.parse({ h: 3, w: 0 })).toThrow();
  });
});

describe("pluginMissionControlWidgetContributionSchema", () => {
  it("parses minimal widget contribution (all sizes use defaults)", () => {
    const result = pluginMissionControlWidgetContributionSchema.parse({
      id: "pier.test.widget",
      title: "Test Widget",
    });
    expect(result).toEqual({
      id: "pier.test.widget",
      permissions: [],
      title: "Test Widget",
    });
  });

  it("parses full widget contribution with explicit sizes", () => {
    const result = pluginMissionControlWidgetContributionSchema.parse({
      defaultSize: { h: 4, w: 6 },
      description: "A test widget",
      id: "pier.test.widget",
      maxSize: { h: 10, w: 8 },
      minSize: { h: 3, w: 3 },
      permissions: ["app:read"],
      title: "Test Widget",
    });
    expect(result.defaultSize).toEqual({ h: 4, w: 6 });
    expect(result.minSize).toEqual({ h: 3, w: 3 });
    expect(result.maxSize).toEqual({ h: 10, w: 8 });
    expect(result.description).toBe("A test widget");
    expect(result.permissions).toEqual(["app:read"]);
  });

  it("defaults permissions to empty array", () => {
    const result = pluginMissionControlWidgetContributionSchema.parse({
      id: "w",
      title: "W",
    });
    expect(result.permissions).toEqual([]);
  });

  it("rejects when min.w > default.w (superRefine bounds check)", () => {
    expect(() =>
      pluginMissionControlWidgetContributionSchema.parse({
        defaultSize: { h: 3, w: 2 },
        id: "bad",
        minSize: { h: 2, w: 5 },
        title: "Bad",
      })
    ).toThrow(W_AXIS_PATTERN);
  });

  it("rejects when default.h > max.h (superRefine bounds check)", () => {
    expect(() =>
      pluginMissionControlWidgetContributionSchema.parse({
        defaultSize: { h: 10, w: 4 },
        id: "bad",
        maxSize: { h: 5, w: 12 },
        title: "Bad",
      })
    ).toThrow(H_AXIS_PATTERN);
  });

  it("passes when omitting all sizes (defaults satisfy bounds)", () => {
    const result = pluginMissionControlWidgetContributionSchema.parse({
      id: "ok",
      title: "OK",
    });
    // 缺省补齐：min={w:2,h:2}, default={w:4,h:3}, max={w:12,h:12} → 合法
    expect(result.id).toBe("ok");
  });

  it("rejects min > default with effective defaults", () => {
    // minSize.w=5, defaultSize 缺省 HOST_DEFAULT=4 → 5 > 4 违反
    expect(() =>
      pluginMissionControlWidgetContributionSchema.parse({
        id: "bad",
        minSize: { h: 2, w: 5 },
        title: "Bad",
      })
    ).toThrow(W_AXIS_PATTERN);
  });
});

describe("missionControlPanelParamsSchema", () => {
  it("parses empty widgets list", () => {
    const result = missionControlPanelParamsSchema.parse({ widgets: [] });
    expect(result.widgets).toEqual([]);
  });

  it("parses widgets with x/y/w/h", () => {
    const result = missionControlPanelParamsSchema.parse({
      widgets: [
        { h: 3, id: "core.activity-overview", w: 4, x: 0, y: 0 },
        { h: 4, id: "pier.codex.accounts", w: 6, x: 4, y: 0 },
      ],
    });
    expect(result.widgets).toHaveLength(2);
    expect(result.widgets[0]?.x).toBe(0);
    expect(result.widgets[1]?.w).toBe(6);
  });

  it("rejects widget without id", () => {
    expect(() =>
      missionControlPanelParamsSchema.parse({
        widgets: [{ h: 3, w: 4, x: 0, y: 0 }],
      })
    ).toThrow();
  });

  it("rejects x exceeding grid bounds", () => {
    expect(() =>
      missionControlPanelParamsSchema.parse({
        widgets: [{ h: 3, id: "w", w: 4, x: 12, y: 0 }],
      })
    ).toThrow();
  });
});

describe("CoreMissionControlWidgetDeclaration type", () => {
  it("is structurally compatible", () => {
    const declaration: CoreMissionControlWidgetDeclaration = {
      defaultSize: { h: 3, w: 4 },
      id: "core.activity-overview",
      minSize: { h: 2, w: 3 },
      titleKey: "missionControl.widget.activityOverview.title",
    };
    expect(declaration.id).toBe("core.activity-overview");
    expect(declaration.titleKey).toBe(
      "missionControl.widget.activityOverview.title"
    );
    expect(declaration.defaultSize).toEqual({ h: 3, w: 4 });
  });
});

describe("契约级缺省常量", () => {
  it("HOST_DEFAULT_WIDGET_SIZE = { h: 3, w: 4 }", () => {
    expect(HOST_DEFAULT_WIDGET_SIZE).toEqual({ h: 3, w: 4 });
  });

  it("HOST_MIN_WIDGET_SIZE = { h: 2, w: 2 }", () => {
    expect(HOST_MIN_WIDGET_SIZE).toEqual({ h: 2, w: 2 });
  });

  it("HOST_MAX_WIDGET_SIZE = { h: 12, w: 12 }", () => {
    expect(HOST_MAX_WIDGET_SIZE).toEqual({ h: 12, w: 12 });
  });
});

describe("pluginManifestSchema missionControlWidgets field", () => {
  const baseManifest = {
    apiVersion: 1,
    engines: { pier: ">=0.1.0" },
    id: "test.plugin",
    name: "Test",
    source: { kind: "builtin" },
    version: "1.0.0",
  };

  it("defaults missionControlWidgets to empty array", () => {
    const result = pluginManifestSchema.parse(baseManifest);
    expect(result.missionControlWidgets).toEqual([]);
  });

  it("parses manifest with missionControlWidgets", () => {
    const result = pluginManifestSchema.parse({
      ...baseManifest,
      missionControlWidgets: [
        {
          defaultSize: { h: 4, w: 4 },
          id: "test.plugin.widget",
          minSize: { h: 3, w: 3 },
          permissions: ["app:read"],
          title: "Test Widget",
        },
      ],
    });
    expect(result.missionControlWidgets).toHaveLength(1);
    expect(result.missionControlWidgets[0]?.id).toBe("test.plugin.widget");
  });
});
