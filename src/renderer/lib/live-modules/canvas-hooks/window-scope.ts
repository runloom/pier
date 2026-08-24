import { currentElectronWindowId } from "@/lib/agent-runtime/current-window-id.ts";

/**
 * 本窗作用域选项：TaskRuns 过滤必须带 `windowId`，否则 background task
 * 可能跨窗泄漏。无窗口 id（非 Electron 环境）时不加过滤。
 */
export function activityWindowScope(): { windowId?: string } | undefined {
  const windowId = currentElectronWindowId();
  return windowId === undefined ? undefined : { windowId };
}
