/**
 * Workspace 布局持久化 — 按 durable window record 保存 dockview 的 toJSON().
 * runtime windowId 会复用, 不能作为布局持久化 key.
 */
import {
  clearWindowRecordLayout,
  readWindowRecordLayout,
  saveWindowRecordLayout,
} from "./window-record-state.ts";

export async function readLayout(recordId: string): Promise<unknown | null> {
  return await readWindowRecordLayout(recordId);
}

export async function saveLayout(
  layout: unknown,
  recordId: string
): Promise<void> {
  await saveWindowRecordLayout(recordId, layout);
}

/**
 * 删除当前 window record 的 layout. 用于命令面板"重置布局"和 closeAll.
 */
export async function clearLayout(recordId: string): Promise<void> {
  await clearWindowRecordLayout(recordId);
}
