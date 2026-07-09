import type { RendererMissionControlWidgetRegistration } from "@plugins/api/renderer.ts";
import type { CoreMissionControlWidgetDeclaration } from "@shared/contracts/mission-control.ts";
import { salvageMissionControlPanelParams } from "@shared/contracts/mission-control.ts";
import type { PluginRegistryEntry } from "@shared/contracts/plugin.ts";
import { House, LayoutDashboard } from "lucide-react";
import { describe, expect, it } from "vitest";
import { resolveMissionControlWidgets } from "@/panel-kits/mission-control/mission-control-merge.ts";

const coreWidget: CoreMissionControlWidgetDeclaration = {
  defaultSize: { h: 3, w: 4 },
  id: "core.activity-overview",
  minSize: { h: 2, w: 3 },
  titleKey: "missionControl.widget.activityOverview.title",
};

const coreReg: RendererMissionControlWidgetRegistration = {
  component: () => null,
  icon: LayoutDashboard,
  id: "core.activity-overview",
};

function pluginEntry(
  pluginId: string,
  widgets: { id: string; title?: string }[],
  opts: { enabled: boolean; runtimeEnabled: boolean }
): PluginRegistryEntry {
  return {
    effectivePermissions: [],
    enabled: opts.enabled,
    manifest: {
      apiVersion: 1,
      commands: [],
      missionControlWidgets: widgets.map((w) => ({
        id: w.id,
        permissions: [],
        title: w.title ?? w.id,
      })),
      settingsPages: [],
      engines: { pier: ">=0.1.0" },
      id: pluginId,
      name: pluginId,
      panels: [],
      permissions: [],
      source: { kind: "builtin" },
      terminalStatusItems: [],
      version: "1.0.0",
    },
    runtime: {
      canToggle: true,
      enabled: opts.runtimeEnabled,
      kind: "builtin",
    },
  } as PluginRegistryEntry;
}

describe("resolveMissionControlWidgets", () => {
  it("resolves core widget from params", () => {
    const result = resolveMissionControlWidgets(
      { widgets: [{ h: 3, id: "core.activity-overview", w: 4, x: 0, y: 0 }] },
      [coreWidget],
      [],
      new Map(),
      new Map([["core.activity-overview", coreReg]])
    );

    expect(result).toHaveLength(1);
    expect(result[0]?.status).toBe("core");
    expect(result[0]?.registration).toBe(coreReg);
  });

  it("resolves plugin-active widget with registration", () => {
    const entry = pluginEntry("pier.codex", [{ id: "pier.codex.accounts" }], {
      enabled: true,
      runtimeEnabled: true,
    });
    const pluginReg: RendererMissionControlWidgetRegistration = {
      component: () => null,
      icon: House,
      id: "pier.codex.accounts",
      title: "Codex Accounts",
    };

    const result = resolveMissionControlWidgets(
      { widgets: [{ h: 4, id: "pier.codex.accounts", w: 4, x: 0, y: 0 }] },
      [],
      [entry],
      new Map([["pier.codex.accounts", pluginReg]]),
      new Map()
    );

    expect(result).toHaveLength(1);
    expect(result[0]?.status).toBe("plugin-active");
    expect(result[0]?.title).toBe("Codex Accounts");
    expect(result[0]?.registration).toBe(pluginReg);
  });

  it("resolves plugin-disabled when plugin runtime not enabled", () => {
    const entry = pluginEntry("pier.codex", [{ id: "pier.codex.accounts" }], {
      enabled: true,
      runtimeEnabled: false,
    });

    const result = resolveMissionControlWidgets(
      { widgets: [{ h: 3, id: "pier.codex.accounts", w: 4, x: 0, y: 0 }] },
      [],
      [entry],
      new Map(),
      new Map()
    );

    expect(result).toHaveLength(1);
    expect(result[0]?.status).toBe("plugin-disabled");
    expect(result[0]?.registration).toBeNull();
  });

  it("resolves unknown when widget id has no matching declaration", () => {
    const result = resolveMissionControlWidgets(
      { widgets: [{ h: 3, id: "gone.widget", w: 4, x: 0, y: 0 }] },
      [],
      [],
      new Map(),
      new Map()
    );

    expect(result).toHaveLength(1);
    expect(result[0]?.status).toBe("unknown");
    expect(result[0]?.registration).toBeNull();
  });

  it("deduplicates widgets within the same mission control", () => {
    const result = resolveMissionControlWidgets(
      {
        widgets: [
          { h: 3, id: "core.activity-overview", w: 4, x: 0, y: 0 },
          { h: 3, id: "core.activity-overview", w: 4, x: 4, y: 0 },
        ],
      },
      [coreWidget],
      [],
      new Map(),
      new Map([["core.activity-overview", coreReg]])
    );

    expect(result).toHaveLength(1);
  });

  it("resolves empty params to empty list", () => {
    const result = resolveMissionControlWidgets(
      { widgets: [] },
      [coreWidget],
      [],
      new Map(),
      new Map()
    );

    expect(result).toHaveLength(0);
  });

  it("resolves title from registration thunk", () => {
    const entry = pluginEntry("pier.codex", [{ id: "pier.codex.accounts" }], {
      enabled: true,
      runtimeEnabled: true,
    });
    const pluginReg: RendererMissionControlWidgetRegistration = {
      component: () => null,
      icon: House,
      id: "pier.codex.accounts",
      title: () => "Dynamic Title",
    };

    const result = resolveMissionControlWidgets(
      { widgets: [{ h: 3, id: "pier.codex.accounts", w: 4, x: 0, y: 0 }] },
      [],
      [entry],
      new Map([["pier.codex.accounts", pluginReg]]),
      new Map()
    );

    expect(result[0]?.title).toBe("Dynamic Title");
  });

  it("plugin-disabled falls back to manifest title, not raw id", () => {
    const entry = pluginEntry(
      "pier.codex",
      [{ id: "pier.codex.accounts", title: "Codex Accounts" }],
      { enabled: false, runtimeEnabled: false }
    );

    const result = resolveMissionControlWidgets(
      { widgets: [{ h: 3, id: "pier.codex.accounts", w: 4, x: 0, y: 0 }] },
      [],
      [entry],
      new Map(),
      new Map()
    );

    expect(result[0]?.status).toBe("plugin-disabled");
    expect(result[0]?.title).toBe("Codex Accounts");
  });

  it("plugin-active but unregistered (loading) uses manifest title, not raw id", () => {
    const entry = pluginEntry(
      "pier.codex",
      [{ id: "pier.codex.accounts", title: "Codex Accounts" }],
      { enabled: true, runtimeEnabled: true }
    );

    // registration Map 为空 → 加载态
    const result = resolveMissionControlWidgets(
      { widgets: [{ h: 3, id: "pier.codex.accounts", w: 4, x: 0, y: 0 }] },
      [],
      [entry],
      new Map(),
      new Map()
    );

    expect(result[0]?.status).toBe("plugin-active");
    expect(result[0]?.registration).toBeNull();
    expect(result[0]?.title).toBe("Codex Accounts");
  });

  it("unknown (plugin uninstalled) keeps raw id as title", () => {
    const result = resolveMissionControlWidgets(
      { widgets: [{ h: 3, id: "gone.widget", w: 4, x: 0, y: 0 }] },
      [],
      [],
      new Map(),
      new Map()
    );

    expect(result[0]?.status).toBe("unknown");
    expect(result[0]?.title).toBe("gone.widget");
  });

  it("v2 实例条目：widgetId 解析物料、instanceId 保持实例身份、params 透传", () => {
    const multiCore: CoreMissionControlWidgetDeclaration = {
      configurable: true,
      id: "core.custom-card",
      multiInstance: true,
      titleKey: "missionControl.widget.customCard.title",
    };
    const reg: RendererMissionControlWidgetRegistration = {
      component: () => null,
      icon: LayoutDashboard,
      id: "core.custom-card",
    };

    const result = resolveMissionControlWidgets(
      {
        widgets: [
          {
            h: 4,
            id: "uuid-1",
            params: { blocks: [{ metricId: "m1" }] },
            w: 3,
            widgetId: "core.custom-card",
            x: 0,
            y: 0,
          },
          {
            h: 4,
            id: "uuid-2",
            w: 3,
            widgetId: "core.custom-card",
            x: 3,
            y: 0,
          },
        ],
      },
      [multiCore],
      [],
      new Map(),
      new Map([["core.custom-card", reg]])
    );

    expect(result).toHaveLength(2);
    expect(result[0]?.instanceId).toBe("uuid-1");
    expect(result[0]?.widgetId).toBe("core.custom-card");
    expect(result[0]?.params).toEqual({ blocks: [{ metricId: "m1" }] });
    expect(result[0]?.configurable).toBe(true);
    expect(result[0]?.multiInstance).toBe(true);
    expect(result[1]?.instanceId).toBe("uuid-2");
    expect(result[1]?.params).toEqual({});
  });

  it("v1 条目回退：instanceId 即 widgetId，能力位缺省 false", () => {
    const result = resolveMissionControlWidgets(
      { widgets: [{ h: 3, id: "core.activity-overview", w: 4, x: 0, y: 0 }] },
      [coreWidget],
      [],
      new Map(),
      new Map([["core.activity-overview", coreReg]])
    );

    expect(result[0]?.instanceId).toBe("core.activity-overview");
    expect(result[0]?.widgetId).toBe("core.activity-overview");
    expect(result[0]?.configurable).toBe(false);
    expect(result[0]?.multiInstance).toBe(false);
    expect(result[0]?.refreshable).toBe(false);
  });
});

describe("salvageMissionControlPanelParams", () => {
  it("整体合法时原样返回", () => {
    const raw = { widgets: [{ h: 3, id: "a", w: 4, x: 0, y: 0 }] };
    expect(salvageMissionControlPanelParams(raw)).toEqual(raw);
  });

  it("混合合法/非法条目时只丢非法项", () => {
    const raw = {
      widgets: [
        { h: 3, id: "good", w: 4, x: 0, y: 0 },
        { h: 3, id: "bad-x", w: 4, x: 12, y: 0 }, // x 越界
        { h: 2.5, id: "bad-h", w: 4, x: 0, y: 3 }, // h 非整数
      ],
    };
    expect(salvageMissionControlPanelParams(raw)).toEqual({
      widgets: [{ h: 3, id: "good", w: 4, x: 0, y: 0 }],
    });
  });

  it("widgets 不是数组 / raw 为 null 时回退空", () => {
    expect(salvageMissionControlPanelParams({ widgets: "junk" })).toEqual({
      widgets: [],
    });
    expect(salvageMissionControlPanelParams(null)).toEqual({ widgets: [] });
    expect(salvageMissionControlPanelParams(undefined)).toEqual({
      widgets: [],
    });
  });

  it("抢救出的条目不含多余字段", () => {
    const raw = {
      widgets: [{ extra: true, h: 3, id: "a", w: 4, x: 0, y: 0 }],
    };
    expect(salvageMissionControlPanelParams(raw)).toEqual({
      widgets: [{ h: 3, id: "a", w: 4, x: 0, y: 0 }],
    });
  });

  it("逐条路径抢救出的条目同样不含多余字段", () => {
    const raw = {
      widgets: [
        { extra: true, h: 3, id: "a", w: 4, x: 0, y: 0 },
        { h: 3, id: "bad", w: 4, x: 12, y: 0 }, // 逼出逐条路径
      ],
    };
    expect(salvageMissionControlPanelParams(raw)).toEqual({
      widgets: [{ h: 3, id: "a", w: 4, x: 0, y: 0 }],
    });
  });
});
