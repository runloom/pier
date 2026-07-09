import type {
  PluginPanelInstanceSnapshot,
  PluginPanelRegistration,
  RendererPluginContext,
} from "@plugins/api/renderer.ts";
import type { PanelContext } from "@shared/contracts/panel.ts";
import type { PierCapability } from "@shared/contracts/permissions.ts";
import type { PluginRegistryEntry } from "@shared/contracts/plugin.ts";
import { registerPanelCloseGuard } from "@/lib/workspace/panel-close-guards.ts";
import { usePanelDescriptorStore } from "../../stores/panel-descriptor.store.ts";
import { useWorkspaceStore } from "../../stores/workspace.store.ts";
import { activateWorkspacePanel } from "../workspace/panel-activation.ts";
import { scheduleRevealDockviewTabByPanelId } from "../workspace/tab-visibility.ts";
import {
  pluginPanelDescriptor,
  resolveRegistrationTitle,
} from "./host-panel-descriptors.ts";
import {
  groupForPanel,
  openPluginPanelInstance,
} from "./host-panel-instance-open.ts";
import { clonePanelParams } from "./host-panel-params.ts";
import {
  getPluginPanelRegistrations,
  registerPluginPanel,
} from "./plugin-panel-registry.ts";

type AssertDeclaredContribution = (
  entry: PluginRegistryEntry | undefined,
  kind: "panel",
  id: string
) => void;

type AssertPluginCapability = (
  entry: PluginRegistryEntry | undefined,
  capability: PierCapability
) => void;

function openPluginPanel(
  panelId: string,
  options: { context?: PanelContext } = {}
): void {
  const api = useWorkspaceStore.getState().api;
  if (!api) {
    return;
  }
  const registration = getPluginPanelRegistrations().get(panelId);
  const descriptorStore = usePanelDescriptorStore.getState();
  // 无来源 context 时保留 panel 已存的 context,避免重开时被抹掉。
  const context =
    options.context ?? descriptorStore.descriptors[panelId]?.context;
  descriptorStore.upsert(
    panelId,
    pluginPanelDescriptor(panelId, registration, context)
  );
  const params = {
    ...(registration?.getParams?.() ?? {}),
    ...(context ? { context } : {}),
  };
  const hasParams = Object.keys(params).length > 0;
  const existing = api.panels.find((panel) => panel.id === panelId);
  if (existing) {
    existing.api.updateParameters(params);
    activateWorkspacePanel(api, existing.id, { reveal: "always" });
    return;
  }
  api.addPanel({
    id: panelId,
    component: panelId,
    title: resolveRegistrationTitle(registration, panelId),
    position: { direction: "right" },
    ...(hasParams ? { params } : {}),
  });
  scheduleRevealDockviewTabByPanelId(panelId);
}

export function createPluginPanelsContext(
  entry: PluginRegistryEntry | undefined,
  assertDeclaredContribution: AssertDeclaredContribution,
  assertPluginCapability: AssertPluginCapability
): RendererPluginContext["panels"] {
  return {
    getActiveContext: () => {
      const state = usePanelDescriptorStore.getState();
      return state.activeId
        ? (state.descriptors[state.activeId]?.context ?? null)
        : null;
    },
    getActiveInstanceId: (componentId) => {
      const panel = useWorkspaceStore.getState().api?.activePanel;
      if (!panel || panel.view.contentComponent !== componentId) {
        return null;
      }
      // 只允许查本插件贡献的组件,避免跨插件泄漏 panel id。
      assertDeclaredContribution(entry, "panel", componentId);
      return panel.id;
    },
    listInstances: (componentId): readonly PluginPanelInstanceSnapshot[] => {
      assertDeclaredContribution(entry, "panel", componentId);
      const api = useWorkspaceStore.getState().api;
      if (!api) {
        return [];
      }
      return api.panels
        .filter((panel) => panel.view.contentComponent === componentId)
        .map((panel) => {
          const snapshot = {
            componentId,
            groupId: groupForPanel(api, panel.id)?.id ?? null,
            id: panel.id,
            title: panel.title || panel.id,
          };
          const params = clonePanelParams(
            panel.params as Record<string, unknown> | undefined
          );
          return params === undefined ? snapshot : { ...snapshot, params };
        });
    },
    open: (panelId, options) => {
      // 与 register 对称:必须在自己 manifest 声明的 panel 才能打开,
      // 防止 A 插件越权打开 B 插件的 panel。
      assertDeclaredContribution(entry, "panel", panelId);
      assertPluginCapability(entry, "panel:open");
      openPluginPanel(panelId, options);
    },
    openInstance: (options) => {
      assertDeclaredContribution(entry, "panel", options.componentId);
      assertPluginCapability(entry, "panel:open");
      openPluginPanelInstance(options);
    },
    register: (registration: PluginPanelRegistration) => {
      assertDeclaredContribution(entry, "panel", registration.id);
      assertPluginCapability(entry, "panel:register");
      return registerPluginPanel(registration);
    },
    registerCloseGuard: (componentId, guard) => {
      assertDeclaredContribution(entry, "panel", componentId);
      assertPluginCapability(entry, "panel:register");
      return registerPanelCloseGuard(componentId, guard);
    },
  };
}
