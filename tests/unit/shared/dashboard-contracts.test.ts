import {
  type CoreDashboardWidgetDeclaration,
  DASHBOARD_GRID_COLS,
  dashboardGridSizeSchema,
  dashboardPanelParamsSchema,
  HOST_DEFAULT_WIDGET_SIZE,
  HOST_MAX_WIDGET_SIZE,
  HOST_MIN_WIDGET_SIZE,
  pluginDashboardWidgetContributionSchema,
} from "@shared/contracts/dashboard.ts";
import { pluginManifestSchema } from "@shared/contracts/plugin.ts";
import { describe, expect, it } from "vitest";

const W_AXIS_PATTERN = /w axis/;
const H_AXIS_PATTERN = /h axis/;

describe("dashboardGridSizeSchema", () => {
  it("accepts valid grid size", () => {
    const result = dashboardGridSizeSchema.parse({ h: 3, w: 4 });
    expect(result).toEqual({ h: 3, w: 4 });
  });

  it("rejects w exceeding DASHBOARD_GRID_COLS", () => {
    expect(() =>
      dashboardGridSizeSchema.parse({ h: 3, w: DASHBOARD_GRID_COLS + 1 })
    ).toThrow();
  });

  it("rejects h exceeding 24", () => {
    expect(() => dashboardGridSizeSchema.parse({ h: 25, w: 4 })).toThrow();
  });

  it("rejects non-integer w", () => {
    expect(() => dashboardGridSizeSchema.parse({ h: 3, w: 4.5 })).toThrow();
  });

  it("rejects w < 1", () => {
    expect(() => dashboardGridSizeSchema.parse({ h: 3, w: 0 })).toThrow();
  });
});

describe("pluginDashboardWidgetContributionSchema", () => {
  it("parses minimal widget contribution (all sizes use defaults)", () => {
    const result = pluginDashboardWidgetContributionSchema.parse({
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
    const result = pluginDashboardWidgetContributionSchema.parse({
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
    const result = pluginDashboardWidgetContributionSchema.parse({
      id: "w",
      title: "W",
    });
    expect(result.permissions).toEqual([]);
  });

  it("rejects when min.w > default.w (superRefine bounds check)", () => {
    expect(() =>
      pluginDashboardWidgetContributionSchema.parse({
        defaultSize: { h: 3, w: 2 },
        id: "bad",
        minSize: { h: 2, w: 5 },
        title: "Bad",
      })
    ).toThrow(W_AXIS_PATTERN);
  });

  it("rejects when default.h > max.h (superRefine bounds check)", () => {
    expect(() =>
      pluginDashboardWidgetContributionSchema.parse({
        defaultSize: { h: 10, w: 4 },
        id: "bad",
        maxSize: { h: 5, w: 12 },
        title: "Bad",
      })
    ).toThrow(H_AXIS_PATTERN);
  });

  it("passes when omitting all sizes (defaults satisfy bounds)", () => {
    const result = pluginDashboardWidgetContributionSchema.parse({
      id: "ok",
      title: "OK",
    });
    // 缺省补齐：min={w:2,h:2}, default={w:4,h:3}, max={w:12,h:12} → 合法
    expect(result.id).toBe("ok");
  });

  it("rejects min > default with effective defaults", () => {
    // minSize.w=5, defaultSize 缺省 HOST_DEFAULT=4 → 5 > 4 违反
    expect(() =>
      pluginDashboardWidgetContributionSchema.parse({
        id: "bad",
        minSize: { h: 2, w: 5 },
        title: "Bad",
      })
    ).toThrow(W_AXIS_PATTERN);
  });
});

describe("dashboardPanelParamsSchema", () => {
  it("parses empty widgets list", () => {
    const result = dashboardPanelParamsSchema.parse({ widgets: [] });
    expect(result.widgets).toEqual([]);
  });

  it("parses widgets with x/y/w/h", () => {
    const result = dashboardPanelParamsSchema.parse({
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
      dashboardPanelParamsSchema.parse({
        widgets: [{ h: 3, w: 4, x: 0, y: 0 }],
      })
    ).toThrow();
  });

  it("rejects x exceeding grid bounds", () => {
    expect(() =>
      dashboardPanelParamsSchema.parse({
        widgets: [{ h: 3, id: "w", w: 4, x: 12, y: 0 }],
      })
    ).toThrow();
  });
});

describe("CoreDashboardWidgetDeclaration type", () => {
  it("is structurally compatible", () => {
    const declaration: CoreDashboardWidgetDeclaration = {
      defaultSize: { h: 3, w: 4 },
      id: "core.activity-overview",
      minSize: { h: 2, w: 3 },
      titleKey: "dashboard.widget.activityOverview.title",
    };
    expect(declaration.id).toBe("core.activity-overview");
    expect(declaration.titleKey).toBe(
      "dashboard.widget.activityOverview.title"
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

describe("pluginManifestSchema dashboardWidgets field", () => {
  const baseManifest = {
    apiVersion: 1,
    engines: { pier: ">=0.1.0" },
    id: "test.plugin",
    name: "Test",
    source: { kind: "builtin" },
    version: "1.0.0",
  };

  it("defaults dashboardWidgets to empty array", () => {
    const result = pluginManifestSchema.parse(baseManifest);
    expect(result.dashboardWidgets).toEqual([]);
  });

  it("parses manifest with dashboardWidgets", () => {
    const result = pluginManifestSchema.parse({
      ...baseManifest,
      dashboardWidgets: [
        {
          defaultSize: { h: 4, w: 4 },
          id: "test.plugin.widget",
          minSize: { h: 3, w: 3 },
          permissions: ["app:read"],
          title: "Test Widget",
        },
      ],
    });
    expect(result.dashboardWidgets).toHaveLength(1);
    expect(result.dashboardWidgets[0]?.id).toBe("test.plugin.widget");
  });
});
