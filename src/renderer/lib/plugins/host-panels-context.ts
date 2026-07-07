import type {
  PluginPanelInstanceOptions,
  PluginPanelRegistration,
  RendererPluginContext,
} from "@plugins/api/renderer.ts";
import type { PanelContext } from "@shared/contracts/panel.ts";
import type { PierCapability } from "@shared/contracts/permissions.ts";
import type { PluginRegistryEntry } from "@shared/contracts/plugin.ts";
import {
  type PanelDescriptor,
  usePanelDescriptorStore,
} from "../../stores/panel-descriptor.store.ts";
import { useWorkspaceStore } from "../../stores/workspace.store.ts";
import { activateWorkspacePanel } from "../workspace/panel-activation.ts";
import { scheduleRevealDockviewTabByPanelId } from "../workspace/tab-visibility.ts";
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

function resolveRegistrationTitle(
  registration: PluginPanelRegistration | undefined,
  fallback: string
): string {
  const title = registration?.title;
  if (typeof title === "function") {
    return title();
  }
  return title ?? fallback;
}

function pluginPanelDescriptor(
  panelId: string,
  registration: PluginPanelRegistration | undefined,
  context: PanelContext | undefined,
  title = resolveRegistrationTitle(registration, panelId)
): PanelDescriptor {
  return {
    ...(context ? { context } : {}),
    display: { short: title },
  };
}

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

function openPluginPanelInstance(options: PluginPanelInstanceOptions): void {
  const api = useWorkspaceStore.getState().api;
  const registration = getPluginPanelRegistrations().get(options.componentId);
  if (!registration) {
    throw new Error(
      `plugin panel component not registered: ${options.componentId}`
    );
  }
  const descriptorStore = usePanelDescriptorStore.getState();
  const context =
    options.context ?? descriptorStore.descriptors[options.instanceId]?.context;
  const resolvedTitle =
    options.title ??
    resolveRegistrationTitle(registration, options.componentId);
  const existing = api?.panels.find((panel) => panel.id === options.instanceId);
  if (
    existing?.view.contentComponent !== undefined &&
    existing.view.contentComponent !== options.componentId
  ) {
    throw new Error(
      `plugin panel instance id collision: ${options.instanceId} already belongs to ${existing.view.contentComponent}`
    );
  }
  descriptorStore.upsert(
    options.instanceId,
    pluginPanelDescriptor(
      options.instanceId,
      registration,
      context,
      resolvedTitle
    )
  );
  if (!api) {
    return;
  }
  const panelParams: Record<string, unknown> = {
    ...(registration.getParams?.() ?? {}),
    ...(options.params ?? {}),
    ...(context ? { context } : {}),
    pluginComponentId: options.componentId,
  };
  if (existing) {
    existing.api.updateParameters(panelParams);
    existing.api.setTitle(resolvedTitle);
    activateWorkspacePanel(api, existing.id, { reveal: "always" });
    return;
  }
  api.addPanel({
    id: options.instanceId,
    component: options.componentId,
    title: resolvedTitle,
    params: panelParams,
  });
  scheduleRevealDockviewTabByPanelId(options.instanceId);
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
  };
}
