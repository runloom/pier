import type { PluginRegistryEntry } from "@shared/contracts/plugin.ts";
import type {
  WorkbenchPanelParams,
  WorkbenchPanelWidgetEntry,
} from "@shared/contracts/workbench.ts";
import { renderHook } from "@testing-library/react";
import { expect, type Mock, vi } from "vitest";
import { useWorkbenchPanelState } from "@/panel-kits/workbench/use-workbench-panel-state.ts";

export interface TestPanelParamsApi {
  updateParameters: Mock<(params: Record<string, unknown>) => void>;
}

interface StateRenderProps {
  api: TestPanelParamsApi;
  plugins: readonly PluginRegistryEntry[];
  value: unknown;
}

export const EMPTY_PLUGINS: readonly PluginRegistryEntry[] = [];

export function createPanelApi(): TestPanelParamsApi {
  return { updateParameters: vi.fn() };
}

export function entry(
  id: string,
  w = 4,
  h = 3,
  extra: Partial<WorkbenchPanelWidgetEntry> = {}
): WorkbenchPanelWidgetEntry {
  return { h, id, w, ...extra };
}

export function params(
  widgets: WorkbenchPanelWidgetEntry[]
): WorkbenchPanelParams {
  return { layoutVersion: 3, widgets };
}

export function widgetIds(snapshot: WorkbenchPanelParams): string[] {
  return snapshot.widgets.map((widget) => widget.id);
}

export function widget(
  snapshot: WorkbenchPanelParams,
  instanceId: string
): WorkbenchPanelWidgetEntry {
  const found = snapshot.widgets.find(
    (candidate) => candidate.id === instanceId
  );
  expect(found, `missing widget ${instanceId}`).toBeDefined();
  return found!;
}

export function renderState(
  initialParams: unknown,
  plugins: readonly PluginRegistryEntry[] = [],
  api: TestPanelParamsApi = createPanelApi()
) {
  const hook = renderHook(
    ({ api: currentApi, plugins: currentPlugins, value }: StateRenderProps) =>
      useWorkbenchPanelState(value, currentApi, currentPlugins),
    {
      initialProps: { api, plugins, value: initialParams },
    }
  );
  const snapshots = (targetApi: TestPanelParamsApi = api) =>
    targetApi.updateParameters.mock.calls.map(
      ([snapshot]) => snapshot as WorkbenchPanelParams
    );
  return {
    ...hook,
    api,
    snapshots,
    updateParameters: api.updateParameters,
  };
}

export const SQUARE_WIDGET_ID = "pier.test.square";

export function squareWidgetPlugins(
  minimumSize = 3
): readonly PluginRegistryEntry[] {
  return [
    {
      manifest: {
        workbenchWidgets: [
          {
            defaultSize: { h: 4, w: 4 },
            id: SQUARE_WIDGET_ID,
            maxSize: { h: 6, w: 6 },
            minSize: { h: minimumSize, w: minimumSize },
            multiInstance: true,
            permissions: [],
            title: "Square",
          },
        ],
      },
      runtime: { enabled: true },
    },
  ] as unknown as readonly PluginRegistryEntry[];
}
