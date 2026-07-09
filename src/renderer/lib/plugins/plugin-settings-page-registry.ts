import type { RendererSettingsPageRegistration } from "@pier/plugin-api/renderer";

const registrations = new Map<string, RendererSettingsPageRegistration>();
const listeners = new Set<() => void>();
let revision = 0;

function notify(): void {
  revision += 1;
  for (const listener of listeners) {
    listener();
  }
}

export function registerPluginSettingsPage(
  pluginId: string,
  registration: RendererSettingsPageRegistration
): () => void {
  registrations.set(pluginId, registration);
  notify();
  return () => {
    if (registrations.get(pluginId) === registration) {
      registrations.delete(pluginId);
      notify();
    }
  };
}

export function getPluginSettingsPage(
  pluginId: string
): RendererSettingsPageRegistration | undefined {
  return registrations.get(pluginId);
}

/**
 * 注册表版本号（每次 register/dispose/clear 自增）。
 * useSyncExternalStore 的 snapshot 函数返回引用稳定的原始值，
 * 让 React 仅在版本变化时重渲染。
 */
export function getPluginSettingsPageRevision(): number {
  return revision;
}

/**
 * 订阅 settings page 注册表变化（给 useSyncExternalStore 用）。
 */
export function subscribePluginSettingsPageRegistry(
  listener: () => void
): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function clearPluginSettingsPagesForTests(): void {
  registrations.clear();
  notify();
}
