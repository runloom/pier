import type {
  WorkbenchWidgetComponentProps as ExternalWorkbenchWidgetComponentProps,
  WorkbenchWidgetSettingsProps as ExternalWorkbenchWidgetSettingsProps,
} from "@pier/plugin-api/renderer";
import type {
  WorkbenchWidgetComponentProps as HostWorkbenchWidgetComponentProps,
  WorkbenchWidgetSettingsProps as HostWorkbenchWidgetSettingsProps,
} from "@plugins/api/renderer.ts";
import type { PluginRegistryEntry } from "@shared/contracts/plugin.ts";
import { afterEach, describe, expect, expectTypeOf, it } from "vitest";
import { createExternalRendererPluginContext } from "@/lib/plugins/external-plugin-context.ts";
import {
  clearPluginWorkbenchWidgetsForTests,
  getPluginWorkbenchWidgetRegistrations,
} from "@/lib/plugins/plugin-workbench-widget-registry.ts";

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
    workbenchWidgets: [
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
  clearPluginWorkbenchWidgetsForTests();
});

describe("external plugin Workbench contract", () => {
  it("keeps public widget component props aligned with the host contract", () => {
    expectTypeOf<ExternalWorkbenchWidgetComponentProps>().toEqualTypeOf<HostWorkbenchWidgetComponentProps>();
    const externalProps =
      null as unknown as ExternalWorkbenchWidgetComponentProps;
    const hostProps = null as unknown as HostWorkbenchWidgetComponentProps;
    const acceptsExternal = (_props: ExternalWorkbenchWidgetComponentProps) =>
      undefined;
    const acceptsHost = (_props: HostWorkbenchWidgetComponentProps) =>
      undefined;

    acceptsExternal(hostProps);
    acceptsHost(externalProps);
  });

  it("keeps public widget settings props aligned with the host contract", () => {
    expectTypeOf<ExternalWorkbenchWidgetSettingsProps>().toEqualTypeOf<HostWorkbenchWidgetSettingsProps>();
    const externalProps =
      null as unknown as ExternalWorkbenchWidgetSettingsProps;
    const hostProps = null as unknown as HostWorkbenchWidgetSettingsProps;
    const acceptsExternal = (_props: ExternalWorkbenchWidgetSettingsProps) =>
      undefined;
    const acceptsHost = (_props: HostWorkbenchWidgetSettingsProps) => undefined;

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
      context.workbenchWidgets.register({
        component: () => null,
        id: EXTERNAL_WIDGET_ID,
      })
    ).toThrow(CONFIGURABLE_WIDGET_SETTINGS_PATTERN);
    expect(
      getPluginWorkbenchWidgetRegistrations().has(EXTERNAL_WIDGET_ID)
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

    const dispose = context.workbenchWidgets.register({
      component,
      id: EXTERNAL_WIDGET_ID,
      settingsComponent,
    });

    expect(
      getPluginWorkbenchWidgetRegistrations().get(EXTERNAL_WIDGET_ID)
    ).toMatchObject({
      component,
      id: EXTERNAL_WIDGET_ID,
      settingsComponent,
    });
    dispose();
  });

  it("keeps the apiVersion 1 runtime alias non-enumerable for installed packages", () => {
    const context = createExternalRendererPluginContext(
      externalPluginEntry,
      bridge,
      () => [externalPluginEntry]
    );
    const legacyContext = context as unknown as {
      missionControlWidgets: typeof context.workbenchWidgets;
    };

    expect(Object.keys(context)).not.toContain("missionControlWidgets");
    const dispose = legacyContext.missionControlWidgets.register({
      component: () => null,
      id: EXTERNAL_WIDGET_ID,
      settingsComponent: () => null,
    });
    expect(
      getPluginWorkbenchWidgetRegistrations().has(EXTERNAL_WIDGET_ID)
    ).toBe(true);
    dispose();
  });
});
