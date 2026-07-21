import type { foregroundActivityService } from "../ipc/foreground-activity.ts";
import type { TaskActivityCallbacks } from "../services/tasks/task-service-types.ts";

type ForegroundActivityService = typeof foregroundActivityService;

/**
 * Task → foreground-activity bridging callbacks, split from app-core.ts
 * (file-size cap). Behavior unchanged.
 */
export function createTaskActivityHandlers(
  foregroundActivityService: ForegroundActivityService
): TaskActivityCallbacks {
  return {
    onLaunched: (panelId, windowId, task) => {
      if (!windowId) {
        // windowId 缺失的 activity 永远路由不到任何 renderer（广播按
        // electron id 定向），入聚合器只会留一个不可见 slot——拒收并留痕。
        // 生产 openTerminalForLaunch 无 windowId 会直接 throw, 此处仅防
        // 类型层面的 undefined。
        console.warn(
          "[task-activity] missing windowId, activity skipped:",
          panelId
        );
        return;
      }
      foregroundActivityService.taskLaunched(panelId, windowId, task);
    },
    onCleared: (panelId, windowId, args) => {
      if (!windowId) {
        console.warn(
          "[task-activity] missing windowId on clear, activity skipped:",
          panelId
        );
        return;
      }
      foregroundActivityService.taskFinished(panelId, windowId, args);
    },
  };
}
