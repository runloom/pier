import type { RendererWorkbenchWidgetRegistration } from "@plugins/api/renderer.ts";
import type { PluginRegistryEntry } from "@shared/contracts/plugin.ts";
import { CORE_RESERVED_WORKBENCH_WIDGET_IDS } from "@shared/plugin-core-contribution-ids.ts";

export function assertPluginWorkbenchWidgetRegistration(
  entry: PluginRegistryEntry | undefined,
  registration: { id: string; settingsComponent?: unknown }
): void {
  if (!entry) {
    return;
  }
  const contribution = entry.manifest.workbenchWidgets.find(
    (widget) => widget.id === registration.id
  );
  if (!contribution) {
    throw new Error(
      `plugin contribution not declared: ${entry.manifest.id}:workbenchWidget:${registration.id}`
    );
  }
  if (contribution.configurable && !registration.settingsComponent) {
    throw new Error(
      `configurable Workbench widget ${entry.manifest.id}:${registration.id} requires settingsComponent`
    );
  }
}

const registrations = new Map<string, RendererWorkbenchWidgetRegistration>();
const listeners = new Set<() => void>();
let revision = 0;

function notify(): void {
  revision += 1;
  for (const listener of listeners) {
    listener();
  }
}

export function registerPluginWorkbenchWidget(
  registration: RendererWorkbenchWidgetRegistration
): () => void {
  if (
    (CORE_RESERVED_WORKBENCH_WIDGET_IDS as readonly string[]).includes(
      registration.id
    )
  ) {
    throw new Error(
      `workbench widget id is reserved by core: ${registration.id}`
    );
  }
  if (registrations.has(registration.id)) {
    throw new Error(
      `workbench widget id is already registered: ${registration.id}`
    );
  }
  registrations.set(registration.id, registration);
  notify();
  return () => {
    if (registrations.get(registration.id) === registration) {
      registrations.delete(registration.id);
      notify();
    }
  };
}

export function getPluginWorkbenchWidgetRegistrations(): ReadonlyMap<
  string,
  RendererWorkbenchWidgetRegistration
> {
  return registrations;
}

/**
 * 注册表版本号（每次 register/dispose/clear 自增）。
 * useSyncExternalStore 的 snapshot 函数返回引用稳定的原始值，
 * 让 React 仅在版本变化时重渲染。
 */
export function getPluginWorkbenchWidgetRevision(): number {
  return revision;
}

/**
 * 订阅 Workbench widget 注册表变化（给 useSyncExternalStore 用）。
 */
export function subscribePluginWorkbenchWidgetRegistry(
  listener: () => void
): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function clearPluginWorkbenchWidgetsForTests(): void {
  registrations.clear();
  notify();
}
