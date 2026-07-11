import type {
  MissionControlWidgetComponentProps as ExternalMissionControlWidgetComponentProps,
  MissionControlWidgetSettingsProps as ExternalMissionControlWidgetSettingsProps,
} from "@pier/plugin-api/renderer";
import type {
  MissionControlWidgetComponentProps as HostMissionControlWidgetComponentProps,
  MissionControlWidgetSettingsProps as HostMissionControlWidgetSettingsProps,
} from "@plugins/api/renderer.ts";
import type { PluginRegistryEntry } from "@shared/contracts/plugin.ts";
import { afterEach, describe, expect, expectTypeOf, it } from "vitest";
import { createExternalRendererPluginContext } from "@/lib/plugins/external-plugin-context.ts";
import {
  clearPluginMissionControlWidgetsForTests,
  getPluginMissionControlWidgetRegistrations,
} from "@/lib/plugins/plugin-mission-control-widget-registry.ts";

const CONFIGURABLE_WIDGET_SETTINGS_PATTERN = /settingsComponent/i;
const EXTERNAL_WIDGET_ID = "pier.demo.configurable-widget";

const externalPluginEntry = {
  effectivePermissions: [],
  enabled: true,
  manifest: {
    apiVersion: 1,
    commands: [],
    engines: { pier: ">=0.1.0" },
    id: "pier.demo",
    missionControlWidgets: [
      {
        configurable: true,
        defaultSize: { h: 4, w: 4 },
        id: EXTERNAL_WIDGET_ID,
        maxSize: { h: 12, w: 12 },
        minSize: { h: 2, w: 2 },
        permissions: [],
        title: "Configurable Widget",
      },
    ],
    name: "Demo",
    panels: [],
    permissions: [],
    settingsPages: [],
    source: { kind: "official" },
    terminalStatusItems: [],
    version: "1.0.0",
  },
  runtime: { canToggle: true, enabled: true, kind: "external" },
} satisfies PluginRegistryEntry;

const bridge = {
  invoke: async () => undefined,
  subscribe: () => () => undefined,
};

afterEach(() => {
  clearPluginMissionControlWidgetsForTests();
});

describe("external plugin Mission Control contract", () => {
  it("keeps public widget component props aligned with the host contract", () => {
    expectTypeOf<ExternalMissionControlWidgetComponentProps>().toEqualTypeOf<HostMissionControlWidgetComponentProps>();
    const externalProps =
      null as unknown as ExternalMissionControlWidgetComponentProps;
    const hostProps = null as unknown as HostMissionControlWidgetComponentProps;
    const acceptsExternal = (
      _props: ExternalMissionControlWidgetComponentProps
    ) => undefined;
    const acceptsHost = (_props: HostMissionControlWidgetComponentProps) =>
      undefined;

    acceptsExternal(hostProps);
    acceptsHost(externalProps);
  });

  it("keeps public widget settings props aligned with the host contract", () => {
    expectTypeOf<ExternalMissionControlWidgetSettingsProps>().toEqualTypeOf<HostMissionControlWidgetSettingsProps>();
    const externalProps =
      null as unknown as ExternalMissionControlWidgetSettingsProps;
    const hostProps = null as unknown as HostMissionControlWidgetSettingsProps;
    const acceptsExternal = (
      _props: ExternalMissionControlWidgetSettingsProps
    ) => undefined;
    const acceptsHost = (_props: HostMissionControlWidgetSettingsProps) =>
      undefined;

    acceptsExternal(hostProps);
    acceptsHost(externalProps);
  });

  it("rejects a configurable external widget without a settings component", () => {
    const context = createExternalRendererPluginContext(
      externalPluginEntry,
      bridge,
      () => [externalPluginEntry]
    );

    expect(() =>
      context.missionControlWidgets.register({
        component: () => null,
        id: EXTERNAL_WIDGET_ID,
      })
    ).toThrow(CONFIGURABLE_WIDGET_SETTINGS_PATTERN);
    expect(
      getPluginMissionControlWidgetRegistrations().has(EXTERNAL_WIDGET_ID)
    ).toBe(false);
  });

  it("registers a configurable external widget with its settings component", () => {
    const context = createExternalRendererPluginContext(
      externalPluginEntry,
      bridge,
      () => [externalPluginEntry]
    );
    const component = () => null;
    const settingsComponent = () => null;

    const dispose = context.missionControlWidgets.register({
      component,
      id: EXTERNAL_WIDGET_ID,
      settingsComponent,
    });

    expect(
      getPluginMissionControlWidgetRegistrations().get(EXTERNAL_WIDGET_ID)
    ).toMatchObject({
      component,
      id: EXTERNAL_WIDGET_ID,
      settingsComponent,
    });
    dispose();
  });
});
