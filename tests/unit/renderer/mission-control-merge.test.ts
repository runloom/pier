import type { RendererMissionControlWidgetRegistration } from "@plugins/api/renderer.ts";
import type {
  CoreMissionControlWidgetDeclaration,
  MissionControlPanelParams,
} from "@shared/contracts/mission-control.ts";
import type { PluginRegistryEntry } from "@shared/contracts/plugin.ts";
import { House, LayoutDashboard } from "lucide-react";
import { describe, expect, it } from "vitest";
import { resolveMissionControlWidgets } from "@/panel-kits/mission-control/mission-control-merge.ts";

const coreWidget: CoreMissionControlWidgetDeclaration = {
  defaultSize: { h: 3, w: 4 },
  id: "core.activity-overview",
  maxSize: { h: 12, w: 12 },
  minSize: { h: 2, w: 3 },
  titleKey: "missionControl.widget.activityOverview.title",
};
const coreRegistration: RendererMissionControlWidgetRegistration = {
  component: () => null,
  icon: LayoutDashboard,
  id: coreWidget.id,
};

function params(
  widgets: MissionControlPanelParams["widgets"]
): MissionControlPanelParams {
  return { layoutVersion: 3, widgets };
}

function pluginEntry(input: {
  enabled: boolean;
  runtimeEnabled: boolean;
}): PluginRegistryEntry {
  return {
    effectivePermissions: [],
    enabled: input.enabled,
    manifest: {
      apiVersion: 1,
      commands: [],
      engines: { pier: ">=0.1.0" },
      id: "pier.codex",
      missionControlWidgets: [
        {
          configurable: true,
          id: "pier.codex.accounts",
          multiInstance: true,
          permissions: [],
          refreshable: true,
          title: "Codex Accounts",
        },
      ],
      name: "Codex",
      panels: [],
      permissions: [],
      settingsPages: [],
      source: { kind: "builtin" },
      terminalStatusItems: [],
      version: "1.0.0",
    },
    runtime: {
      canToggle: true,
      enabled: input.runtimeEnabled,
      kind: "builtin",
    },
  };
}

describe("resolveMissionControlWidgets", () => {
  it("resolves core widgets in persisted array order", () => {
    const result = resolveMissionControlWidgets(
      params([{ h: 3, id: coreWidget.id, w: 4 }]),
      [coreWidget],
      [],
      new Map(),
      new Map([[coreWidget.id, coreRegistration]])
    );

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      instanceId: coreWidget.id,
      registration: coreRegistration,
      status: "core",
      widgetId: coreWidget.id,
    });
  });

  it("resolves active plugin registration and contribution capabilities", () => {
    const registration: RendererMissionControlWidgetRegistration = {
      component: () => null,
      icon: House,
      id: "pier.codex.accounts",
      title: "Accounts runtime",
    };
    const result = resolveMissionControlWidgets(
      params([
        {
          h: 4,
          id: "instance-1",
          params: { account: "work" },
          w: 4,
          widgetId: "pier.codex.accounts",
        },
      ]),
      [],
      [pluginEntry({ enabled: true, runtimeEnabled: true })],
      new Map([[registration.id, registration]]),
      new Map()
    );

    expect(result[0]).toMatchObject({
      configurable: true,
      instanceId: "instance-1",
      multiInstance: true,
      params: { account: "work" },
      refreshable: true,
      status: "plugin-active",
      title: "Accounts runtime",
      widgetId: "pier.codex.accounts",
    });
  });

  it("distinguishes disabled and uninstalled widgets", () => {
    const disabled = resolveMissionControlWidgets(
      params([{ h: 3, id: "pier.codex.accounts", w: 4 }]),
      [],
      [pluginEntry({ enabled: false, runtimeEnabled: false })],
      new Map(),
      new Map()
    );
    const unknown = resolveMissionControlWidgets(
      params([{ h: 3, id: "gone.widget", w: 4 }]),
      [],
      [],
      new Map(),
      new Map()
    );

    expect(disabled[0]).toMatchObject({
      status: "plugin-disabled",
      title: "Codex Accounts",
    });
    expect(unknown[0]).toMatchObject({
      status: "unknown",
      title: "gone.widget",
    });
  });

  it("deduplicates equal instance ids but preserves separate multi-instances", () => {
    const result = resolveMissionControlWidgets(
      params([
        { h: 3, id: "same", w: 4, widgetId: "pier.codex.accounts" },
        { h: 3, id: "same", w: 4, widgetId: "pier.codex.accounts" },
        { h: 3, id: "other", w: 4, widgetId: "pier.codex.accounts" },
      ]),
      [],
      [pluginEntry({ enabled: true, runtimeEnabled: true })],
      new Map(),
      new Map()
    );

    expect(result.map((widget) => widget.instanceId)).toEqual([
      "same",
      "other",
    ]);
  });
});
