import {
  missionControlGridSizeSchema,
  missionControlPanelParamsSchema,
  pluginMissionControlWidgetContributionSchema,
  salvageMissionControlPanelParams,
  widgetEntryWidgetId,
} from "@shared/contracts/mission-control.ts";
import { pluginManifestSchema } from "@shared/contracts/plugin.ts";
import { describe, expect, it } from "vitest";

describe("Mission Control size declarations", () => {
  it.each([
    { h: 2, w: 2 },
    { h: 12, w: 12 },
  ])("accepts the contribution boundary $w×$h", (size) => {
    expect(missionControlGridSizeSchema.parse(size)).toEqual(size);
  });

  it.each([
    { h: 2, w: 1 },
    { h: 13, w: 12 },
    { h: 2.5, w: 2 },
  ])("rejects an invalid contribution size", (size) => {
    expect(() => missionControlGridSizeSchema.parse(size)).toThrow();
  });

  it("keeps deprecated layout metadata parse-compatible for v1 manifests", () => {
    const parsed = pluginMissionControlWidgetContributionSchema.parse({
      defaultSize: { h: 4, w: 4 },
      id: "pier.test.widget",
      layoutPriority: "primary",
      layoutProfiles: [{ h: 3, key: "compact", w: 3 }],
      maxSize: { h: 8, w: 8 },
      minSize: { h: 2, w: 2 },
      title: "Test",
    });

    expect(parsed.layoutPriority).toBe("primary");
    expect(parsed.layoutProfiles).toEqual([{ h: 3, key: "compact", w: 3 }]);
  });

  it("rejects reversed min/default/max bounds", () => {
    expect(() =>
      pluginMissionControlWidgetContributionSchema.parse({
        defaultSize: { h: 4, w: 4 },
        id: "pier.test.widget",
        maxSize: { h: 8, w: 8 },
        minSize: { h: 2, w: 5 },
        title: "Test",
      })
    ).toThrow(/w axis/);
  });

  it("keeps new contribution metadata in plugin manifests", () => {
    const manifest = pluginManifestSchema.parse({
      apiVersion: 1,
      engines: { pier: ">=0.1.0" },
      id: "pier.test",
      missionControlWidgets: [
        {
          category: "analytics",
          configurable: true,
          id: "pier.test.widget",
          multiInstance: true,
          refreshable: true,
          searchTerms: ["usage"],
          title: "Test",
        },
      ],
      name: "Test",
      source: { kind: "builtin" },
      version: "1.0.0",
    });

    expect(manifest.missionControlWidgets[0]).toMatchObject({
      category: "analytics",
      configurable: true,
      multiInstance: true,
      refreshable: true,
      searchTerms: ["usage"],
    });
  });
});

describe("missionControlPanelParamsSchema v3", () => {
  it("persists only ordered instances and preferred sizes", () => {
    const result = missionControlPanelParamsSchema.parse({
      layoutVersion: 3,
      widgets: [
        {
          h: 4,
          id: "uuid-1",
          params: { metricId: "core.cpu" },
          w: 6,
          widgetId: "core.custom-card",
        },
      ],
    });

    expect(result).toEqual({
      layoutVersion: 3,
      widgets: [
        {
          h: 4,
          id: "uuid-1",
          params: { metricId: "core.cpu" },
          w: 6,
          widgetId: "core.custom-card",
        },
      ],
    });
  });

  it("requires layoutVersion 3", () => {
    expect(() =>
      missionControlPanelParamsSchema.parse({ widgets: [] })
    ).toThrow();
  });

  it("strips obsolete geometry and layout controls from v3 input", () => {
    expect(
      missionControlPanelParamsSchema.parse({
        layoutVersion: 3,
        locked: true,
        placementDirection: "vertical",
        widgets: [{ h: 3, id: "a", w: 4, x: 9, y: 8 }],
      })
    ).toEqual({
      layoutVersion: 3,
      widgets: [{ h: 3, id: "a", w: 4 }],
    });
  });

  it("rejects non-JSON private params", () => {
    expect(() =>
      missionControlPanelParamsSchema.parse({
        layoutVersion: 3,
        widgets: [{ h: 3, id: "a", params: { render: () => null }, w: 4 }],
      })
    ).toThrow();
  });
});

describe("salvageMissionControlPanelParams", () => {
  it("keeps v3 array order and drops invalid siblings", () => {
    expect(
      salvageMissionControlPanelParams({
        layoutVersion: 3,
        widgets: [
          { h: 3, id: "b", w: 4 },
          { h: 0, id: "bad", w: 4 },
          { h: 3, id: "a", w: 4 },
        ],
      })
    ).toEqual({
      layoutVersion: 3,
      widgets: [
        { h: 3, id: "b", w: 4 },
        { h: 3, id: "a", w: 4 },
      ],
    });
  });

  it("migrates legacy coordinates to stable y/x/source reading order", () => {
    expect(
      salvageMissionControlPanelParams({
        locked: true,
        placementDirection: "vertical",
        widgets: [
          { h: 3, id: "c", w: 4, x: 4, y: 3 },
          { h: 3, id: "b", w: 4, x: 4, y: 0 },
          { h: 3, id: "a", w: 4, x: 0, y: 0 },
        ],
      })
    ).toEqual({
      layoutVersion: 3,
      widgets: [
        { h: 3, id: "a", w: 4 },
        { h: 3, id: "b", w: 4 },
        { h: 3, id: "c", w: 4 },
      ],
    });
  });

  it("does not treat a versionless semantic entry as legacy geometry", () => {
    expect(
      salvageMissionControlPanelParams({ widgets: [{ h: 3, id: "a", w: 4 }] })
    ).toEqual({
      layoutVersion: 3,
      widgets: [],
    });
  });

  it("falls back to an empty v3 layout for invalid input", () => {
    expect(salvageMissionControlPanelParams(null)).toEqual({
      layoutVersion: 3,
      widgets: [],
    });
  });
});

describe("widgetEntryWidgetId", () => {
  it("uses widgetId for multi-instance entries and falls back to id", () => {
    expect(widgetEntryWidgetId({ id: "uuid", widgetId: "core.a" })).toBe(
      "core.a"
    );
    expect(widgetEntryWidgetId({ id: "core.a" })).toBe("core.a");
  });
});
