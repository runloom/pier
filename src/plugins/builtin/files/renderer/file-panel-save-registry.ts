/**
 * File-panel 实例级 save fn 注册表。
 *
 * 每个挂载的文件面板在 mount 时注册自己的 save 回调,keyed by dockview
 * panel instance id;unmount 时清理。Cmd+S action.handler 从
 * `context.panels.getActiveInstanceId(FILES_FILE_PANEL_ID)` 拿到活动 panel,
 * 查表 → 调用对应 save。
 *
 * 用 module-level Map 而不是 zustand:save 是命令式动作,没有订阅方
 * 关心它的存在与否,只有 dispatch 一次;引 store 只会白搭订阅开销。
 */
const registry = new Map<string, () => Promise<void>>();

export function registerFilePanelSave(
  panelId: string,
  save: () => Promise<void>
): () => void {
  registry.set(panelId, save);
  return () => {
    // 只在 fn 引用未被后续覆盖时清理,避免同 id 快速 re-register 时误删。
    if (registry.get(panelId) === save) {
      registry.delete(panelId);
    }
  };
}

export function triggerFilePanelSave(
  panelId: string | null
): Promise<void> | undefined {
  if (!panelId) {
    return;
  }
  const fn = registry.get(panelId);
  return fn?.();
}
