import type { RendererMissionControlWidgetRegistration } from "@plugins/api/renderer.ts";

const registrations = new Map<
  string,
  RendererMissionControlWidgetRegistration
>();
const listeners = new Set<() => void>();
let revision = 0;

function notify(): void {
  revision += 1;
  for (const listener of listeners) {
    listener();
  }
}

export function registerPluginMissionControlWidget(
  registration: RendererMissionControlWidgetRegistration
): () => void {
  registrations.set(registration.id, registration);
  notify();
  return () => {
    if (registrations.get(registration.id) === registration) {
      registrations.delete(registration.id);
      notify();
    }
  };
}

export function getPluginMissionControlWidgetRegistrations(): ReadonlyMap<
  string,
  RendererMissionControlWidgetRegistration
> {
  return registrations;
}

/**
 * 注册表版本号（每次 register/dispose/clear 自增）。
 * useSyncExternalStore 的 snapshot 函数返回引用稳定的原始值，
 * 让 React 仅在版本变化时重渲染。
 */
export function getPluginMissionControlWidgetRevision(): number {
  return revision;
}

/**
 * 订阅 Mission Control widget 注册表变化（给 useSyncExternalStore 用）。
 */
export function subscribePluginMissionControlWidgetRegistry(
  listener: () => void
): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function clearPluginMissionControlWidgetsForTests(): void {
  registrations.clear();
  notify();
}
