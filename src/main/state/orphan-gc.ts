/**
 * 启动时 orphan GC 入口。
 *
 * 对比 workspace-state.records keys 与 panel-state windows keys，
 * 清理无对应 record 的 panel-state 条目。
 *
 * 目前仅预留 hook 点；真正的 panel-state 接入待 Wave 2 落地后启用。
 */

/** GC 输入：两组 key 集合用于交叉对比。 */
export interface OrphanGCInputs {
  panelStateKeys: readonly string[];
  workspaceStateKeys: readonly string[];
}

/**
 * 从 panelStateKeys 中挑出在 workspaceStateKeys 里无对应项的 orphan keys。
 *
 * 纯函数，不产生副作用；调用方决定如何处置返回的 orphan keys。
 */
export function pickOrphanKeys(inputs: OrphanGCInputs): string[] {
  const wsSet = new Set(inputs.workspaceStateKeys);
  return inputs.panelStateKeys.filter((k) => !wsSet.has(k));
}
