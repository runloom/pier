import type { PluginPanelRegistration } from "@plugins/api/renderer.ts";

const registrations = new Map<string, PluginPanelRegistration>();
const listeners = new Set<() => void>();
let revision = 0;

/**
 * dispose 注册时调用的清理钩子。workspace-host 注入,用于关闭已打开的 dockview
 * panel —— 仅删 registration 不关 panel 会让禁用插件后旧 dockview 实例残留,
 * 重启时 fromJSON 找不到 component(因 component 已 unregister)。
 */
let panelCloser: ((panelId: string) => void) | null = null;

export function setPluginPanelCloser(
  closer: ((panelId: string) => void) | null
): void {
  panelCloser = closer;
}

function notify(): void {
  revision += 1;
  for (const listener of listeners) {
    listener();
  }
}

export function registerPluginPanel(
  registration: PluginPanelRegistration
): () => void {
  registrations.set(registration.id, registration);
  notify();
  return () => {
    if (registrations.get(registration.id) === registration) {
      // 先关已打开的 dockview 实例,再删 component 注册 —— 顺序反了的话,
      // dockview render 时找不到 component 会报错。
      panelCloser?.(registration.id);
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
 * 注册表版本号(每次 register/dispose/clear 自增)。
 * useSyncExternalStore 的 snapshot 函数返回引用稳定的原始值,
 * 让 React 仅在版本变化时重渲染,避免每次 render 拿到新对象。
 */
export function getPluginPanelRevision(): number {
  return revision;
}

/**
 * 订阅插件 panel 注册表变化(给 useSyncExternalStore 用)。
 * 用户在 Settings 启用/禁用插件时, PLUGINS_CHANGED 广播落进 plugin-registry
 * 镜像 store, bootstrap 的订阅据此对 runtime dispose+re-activate,
 * 订阅者随之重算 dockview 组件表,保证开关插件后能立即打开/收起对应面板,无需重启。
 */
export function subscribePluginPanelRegistry(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function clearPluginPanelsForTests(): void {
  registrations.clear();
  panelCloser = null;
  notify();
}
