import type { PluginPanelRegistration } from "@plugins/api/renderer.ts";

const registrations = new Map<string, PluginPanelRegistration>();
const listeners = new Set<() => void>();
let revision = 0;

function notify(): void {
  revision += 1;
  for (const listener of listeners) {
    listener();
  }
}

/**
 * 注册表版本号(每次 register/dispose/clear 自增)。
 * useSyncExternalStore 的 snapshot 函数返回引用稳定的原始值,
 * 让 React 仅在版本变化时重渲染,避免每次 render 拿到新对象。
 */
export function getPluginPanelRevision(): number {
  return revision;
}

export function registerPluginPanel(
  registration: PluginPanelRegistration
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

export function getPluginPanelRegistrations(): ReadonlyMap<
  string,
  PluginPanelRegistration
> {
  return registrations;
}

/**
 * 订阅插件 panel 注册表变化(给 useSyncExternalStore 用)。
 * 用户在 Settings 启用/禁用插件时,refreshBuiltinPlugins() 触发 dispose+re-activate,
 * 订阅者据此重算 dockview 组件表,保证开关插件后能立即打开/收起对应面板,无需重启。
 */
export function subscribePluginPanelRegistry(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function clearPluginPanelsForTests(): void {
  registrations.clear();
  notify();
}
