import type {
  PluginPanelInstanceOpenResult,
  PluginPanelInstanceOptions,
  PluginPanelRegistration,
} from "@plugins/api/renderer.ts";
import type { PanelContext } from "@shared/contracts/panel.ts";
import { usePanelDescriptorStore } from "@/stores/panel-descriptor.store.ts";
import { useWorkspaceStore } from "@/stores/workspace.store.ts";
import { activateWorkspacePanel } from "../workspace/panel-activation.ts";
import { scheduleRevealDockviewTabByPanelId } from "../workspace/tab-visibility.ts";
import {
  pluginPanelDescriptor,
  resolveRegistrationTitle,
} from "./host-panel-descriptors.ts";
import { sameParamValue } from "./host-panel-params.ts";
import { getPluginPanelRegistrations } from "./plugin-panel-registry.ts";

type WorkspaceDockviewApi = NonNullable<
  ReturnType<typeof useWorkspaceStore.getState>["api"]
>;
type DockviewPanelRef = WorkspaceDockviewApi["panels"][number];
type DockviewGroupRef = NonNullable<WorkspaceDockviewApi["activeGroup"]>;

function groupById(
  api: WorkspaceDockviewApi,
  groupId: string | undefined
): DockviewGroupRef | null {
  if (groupId === undefined) {
    return api.activeGroup ?? null;
  }
  return api.groups.find((group) => group.id === groupId) ?? null;
}

export function groupForPanel(
  api: WorkspaceDockviewApi,
  panelId: string
): DockviewGroupRef | null {
  for (const group of api.groups) {
    if (group.panels.some((panel) => panel.id === panelId)) {
      return group;
    }
  }
  return null;
}

function panelsForPreviewReplacement(
  targetGroup: DockviewGroupRef | null
): readonly DockviewPanelRef[] {
  return targetGroup?.panels ?? [];
}

function preservePinnedState(
  existingParams: { pinned?: unknown } | undefined,
  nextParams: Record<string, unknown>,
  previewReplacement: boolean
): Record<string, unknown> {
  if (
    previewReplacement &&
    existingParams?.pinned === true &&
    nextParams.pinned === false
  ) {
    return { ...nextParams, pinned: true };
  }
  return nextParams;
}

function registeredPanelInstance(componentId: string): PluginPanelRegistration {
  const registration = getPluginPanelRegistrations().get(componentId);
  if (!registration) {
    throw new Error(`plugin panel component not registered: ${componentId}`);
  }
  return registration;
}

function assertPanelInstanceComponent(
  options: PluginPanelInstanceOptions,
  existing: DockviewPanelRef | undefined
): void {
  if (
    existing?.view.contentComponent !== undefined &&
    existing.view.contentComponent !== options.componentId
  ) {
    throw new Error(
      `plugin panel instance id collision: ${options.instanceId} already belongs to ${existing.view.contentComponent}`
    );
  }
}

function resolvePanelInstanceTargetGroups(
  api: WorkspaceDockviewApi,
  existing: DockviewPanelRef | undefined,
  options: PluginPanelInstanceOptions
): {
  addPanelTargetGroup: DockviewGroupRef | null;
  previewReplacementGroup: DockviewGroupRef | null;
} {
  const addPanelTargetGroup =
    options.targetGroupId === undefined
      ? null
      : groupById(api, options.targetGroupId);
  const previewReplacementGroup =
    options.targetGroupId === undefined
      ? groupById(api, undefined)
      : addPanelTargetGroup;
  if (existing && options.targetGroupId !== undefined) {
    const existingGroupId = groupForPanel(api, existing.id)?.id ?? null;
    if (existingGroupId !== options.targetGroupId) {
      throw new Error(
        `plugin panel instance target group mismatch: ${options.instanceId} requested ${options.targetGroupId}, existing ${existingGroupId ?? "unknown"}`
      );
    }
  }
  return { addPanelTargetGroup, previewReplacementGroup };
}

function panelInstanceParams(
  registration: PluginPanelRegistration,
  options: PluginPanelInstanceOptions,
  context: PanelContext | undefined
): Record<string, unknown> {
  return {
    ...(registration.getParams?.() ?? {}),
    ...(options.params ?? {}),
    ...(context ? { context } : {}),
    pluginComponentId: options.componentId,
  };
}

function upsertPanelInstanceDescriptor(
  descriptorStore: ReturnType<typeof usePanelDescriptorStore.getState>,
  registration: PluginPanelRegistration,
  options: PluginPanelInstanceOptions,
  context: PanelContext | undefined,
  title: string,
  params: Readonly<Record<string, unknown>>
): void {
  descriptorStore.upsert(
    options.instanceId,
    pluginPanelDescriptor(
      options.instanceId,
      registration,
      context,
      title,
      params
    )
  );
}

function updateExistingPanelInstance(input: {
  api: WorkspaceDockviewApi;
  context: PanelContext | undefined;
  descriptorStore: ReturnType<typeof usePanelDescriptorStore.getState>;
  existing: DockviewPanelRef;
  options: PluginPanelInstanceOptions;
  panelParams: Record<string, unknown>;
  registration: PluginPanelRegistration;
  title: string;
}): void {
  const nextParams = preservePinnedState(
    input.existing.params as { pinned?: unknown } | undefined,
    input.panelParams,
    input.options.dropUnpinnedInstances === true
  );
  upsertPanelInstanceDescriptor(
    input.descriptorStore,
    input.registration,
    input.options,
    input.context,
    input.title,
    nextParams
  );
  if (!sameParamValue(input.existing.params, nextParams)) {
    input.existing.api.updateParameters(nextParams);
  }
  input.existing.api.setTitle(input.title);
  activateWorkspacePanel(input.api, input.existing.id, { reveal: "always" });
}

function previewPanelsToCloseForInstance(
  options: PluginPanelInstanceOptions,
  panelParams: Record<string, unknown>,
  previewReplacementGroup: DockviewGroupRef | null
): readonly DockviewPanelRef[] {
  if (!(options.dropUnpinnedInstances && panelParams.pinned !== true)) {
    return [];
  }
  // Preview-tab 语义:先记住目标 group 内同 componentId 的其他未 pinned 实例。
  // 新 panel 成功加入后再关旧 preview,避免 dockview 因最后一个 panel 被关闭而移除 group。
  return panelsForPreviewReplacement(previewReplacementGroup).filter(
    (other) =>
      other.id !== options.instanceId &&
      other.view.contentComponent === options.componentId &&
      (other.params as { pinned?: unknown } | undefined)?.pinned !== true
  );
}

function addNewPanelInstance(input: {
  addPanelTargetGroup: DockviewGroupRef | null;
  api: WorkspaceDockviewApi;
  context: PanelContext | undefined;
  descriptorStore: ReturnType<typeof usePanelDescriptorStore.getState>;
  options: PluginPanelInstanceOptions;
  panelParams: Record<string, unknown>;
  previewPanelsToClose: readonly DockviewPanelRef[];
  registration: PluginPanelRegistration;
  title: string;
}): void {
  input.api.addPanel({
    id: input.options.instanceId,
    component: input.options.componentId,
    title: input.title,
    params: input.panelParams,
    ...(input.addPanelTargetGroup
      ? {
          position: {
            referenceGroup: input.addPanelTargetGroup,
            direction: "within",
          },
        }
      : {}),
  });
  upsertPanelInstanceDescriptor(
    input.descriptorStore,
    input.registration,
    input.options,
    input.context,
    input.title,
    input.panelParams
  );
  for (const panel of input.previewPanelsToClose) {
    panel.api.close();
  }
  scheduleRevealDockviewTabByPanelId(input.options.instanceId);
}

export function openPluginPanelInstance(
  options: PluginPanelInstanceOptions
): PluginPanelInstanceOpenResult {
  const api = useWorkspaceStore.getState().api;
  const registration = registeredPanelInstance(options.componentId);
  if (
    !api ||
    (options.targetGroupId !== undefined &&
      groupById(api, options.targetGroupId) === null)
  ) {
    return { kind: "targetGroupMissing" };
  }
  const descriptorStore = usePanelDescriptorStore.getState();
  const context =
    options.context ?? descriptorStore.descriptors[options.instanceId]?.context;
  const resolvedTitle =
    options.title ??
    resolveRegistrationTitle(registration, options.componentId);
  const existing = api?.panels.find((panel) => panel.id === options.instanceId);
  assertPanelInstanceComponent(options, existing);
  const { addPanelTargetGroup, previewReplacementGroup } =
    resolvePanelInstanceTargetGroups(api, existing, options);
  const panelParams = panelInstanceParams(registration, options, context);
  if (existing) {
    updateExistingPanelInstance({
      api,
      context,
      descriptorStore,
      existing,
      options,
      panelParams,
      registration,
      title: resolvedTitle,
    });
    return { kind: "opened" };
  }
  addNewPanelInstance({
    addPanelTargetGroup,
    api,
    context,
    descriptorStore,
    options,
    panelParams,
    previewPanelsToClose: previewPanelsToCloseForInstance(
      options,
      panelParams,
      previewReplacementGroup
    ),
    registration,
    title: resolvedTitle,
  });
  return { kind: "opened" };
}
