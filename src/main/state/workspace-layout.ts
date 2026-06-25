/**
 * Workspace 布局持久化 — 存 dockview 的 toJSON() 序列化结果到 userData.
 * reload / 重启窗口后从这里恢复 panel 布局.
 */
import { join } from "node:path";
import { app } from "electron";
import {
  type DebouncedJsonStore,
  debouncedJsonStore,
} from "./debounced-store.ts";

function resolveFilePath(): string {
  return join(app.getPath("userData"), "workspace-layout.json");
}

let store: DebouncedJsonStore<unknown> | undefined;

function getStore(): DebouncedJsonStore<unknown> {
  if (!store) {
    store = debouncedJsonStore<unknown>({
      filePath: resolveFilePath(),
      defaults: null,
      debounceMs: 500,
    });
  }
  return store;
}

async function ensureStore(): Promise<DebouncedJsonStore<unknown>> {
  const s = getStore();
  await s.init();
  return s;
}

export async function readLayout(): Promise<unknown | null> {
  const s = await ensureStore();
  const state = s.get();
  // null means no layout was ever persisted or it was cleared
  return state;
}

export async function saveLayout(layout: unknown): Promise<void> {
  const s = await ensureStore();
  s.replace(layout);
}

/**
 * 删除持久化 layout 文件. 用于命令面板"重置布局"操作 — renderer 删 dockview
 * 所有 panel + 重建 default panel 后再调本方法, 防止后续 reload 又恢复旧 layout.
 *
 * 文件不存在视为成功 (idempotent).
 */
export async function clearLayout(): Promise<void> {
  const s = await ensureStore();
  await s.clear();
}
