import type {
  PluginPanelFocusInstanceResult,
  PluginPanelGlobalInstanceSnapshot,
  PluginPanelInstanceSnapshot,
  PluginPanelRegistration,
  RendererPluginContext,
} from "@plugins/api/renderer.ts";
import type { PanelContext, PanelSnapshot } from "@shared/contracts/panel.ts";
import type { PierCapability } from "@shared/contracts/permissions.ts";
import type { PluginRegistryEntry } from "@shared/contracts/plugin.ts";
import { registerPanelCloseGuard } from "@/lib/workspace/panel-close-guards.ts";
import { resolvePanelPathAnchor } from "@/stores/workspace-panel-helpers.ts";
import { usePanelDescriptorStore } from "../../stores/panel-descriptor.store.ts";
import { useWorkspaceStore } from "../../stores/workspace.store.ts";

import { activateWorkspacePanel } from "../workspace/panel-activation.ts";
import { scheduleRevealDockviewTabByPanelId } from "../workspace/tab-visibility.ts";
import { flushWorkspaceLayout } from "../workspace/workspace-layout-persistence.ts";
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

function isPanelListAggregate(
  value: unknown
): value is { panels: PanelSnapshot[] } {
  return (
    typeof value === "object" &&
    value !== null &&
    "panels" in value &&
    Array.isArray((value as { panels: unknown }).panels)
  );
}

function panelsFromListResult(listed: unknown): PanelSnapshot[] {
  if (Array.isArray(listed)) {
    return listed;
  }
  if (isPanelListAggregate(listed)) {
    return listed.panels;
  }
  return [];
}

function globalInstancesFromPanelList(
  componentId: string,
  listed: PanelSnapshot[]
): PluginPanelGlobalInstanceSnapshot[] {
  const out: PluginPanelGlobalInstanceSnapshot[] = [];
  for (const panel of listed) {
    if (panel.component !== componentId || !panel.windowId) {
      continue;
    }
    const snapshot: PluginPanelGlobalInstanceSnapshot = {
      componentId,
      groupId: null,
      id: panel.id,
      title: panel.display?.short ?? panel.id,
      windowId: panel.windowId,
    };
    const params = clonePanelParams(
      panel.params as Record<string, unknown> | undefined
    );
    out.push(params === undefined ? snapshot : { ...snapshot, params });
  }
  return out;
}

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
  // 优先级：显式传入 → 已存 descriptor → 当前活动 panel 持有的路径。
  // 项目相关插件 panel 打开时必须钉住路径，避免只依赖同组终端回退。
  const context =
    options.context ??
    descriptorStore.descriptors[panelId]?.context ??
    resolvePanelPathAnchor({ api }).context;
  const params = {
    ...(registration?.getParams?.() ?? {}),
    ...(context ? { context } : {}),
  };
  const title = resolveRegistrationTitle(registration, panelId);
  descriptorStore.upsert(
    panelId,
    pluginPanelDescriptor(panelId, registration, context, title, params)
  );
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
    title,
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
    flushLayout: async () => {
      assertPluginCapability(entry, "panel:open");
      await flushWorkspaceLayout();
    },
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
    listInstancesGlobal: async (componentId) => {
      assertDeclaredContribution(entry, "panel", componentId);
      assertPluginCapability(entry, "panel:open");
      const listed = await window.pier.panels.list();
      return globalInstancesFromPanelList(
        componentId,
        panelsFromListResult(listed)
      );
    },
    focusInstance: async ({
      componentId,
      instanceId,
      windowId,
    }): Promise<PluginPanelFocusInstanceResult> => {
      assertDeclaredContribution(entry, "panel", componentId);
      assertPluginCapability(entry, "panel:open");
      try {
        const listed = await window.pier.panels.list(windowId);
        const match = panelsFromListResult(listed).find(
          (panel) =>
            panel.id === instanceId &&
            (panel.component === undefined || panel.component === componentId)
        );
        if (!match) {
          return { kind: "not_found" };
        }
        await window.pier.panels.focus(instanceId, { windowId });
        return { kind: "focused" };
      } catch (error) {
        return {
          kind: "error",
          message: error instanceof Error ? error.message : String(error),
        };
      }
    },
    updateInstanceParams: (componentId, instanceId, patch) => {
      assertDeclaredContribution(entry, "panel", componentId);
      assertPluginCapability(entry, "panel:open");
      const panel = useWorkspaceStore
        .getState()
        .api?.panels.find(
          (candidate) =>
            candidate.id === instanceId &&
            candidate.view.contentComponent === componentId
        );
      if (!panel) {
        return false;
      }
      panel.api.updateParameters({
        ...(clonePanelParams(
          panel.params as Record<string, unknown> | undefined
        ) ?? {}),
        ...patch,
      });
      return true;
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
      return openPluginPanelInstance(options);
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
