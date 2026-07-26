import type { TaskRunControlEntry } from "@shared/contracts/tasks.ts";

/**
 * 任务终态由控制条 + 面板承接；不自动关则不丢内容，故不写消息中心。
 */
export function notifyTaskRunFinishedIfNeeded(_run: TaskRunControlEntry): void {
  // no-op
}

export function clearTaskRunFinishedNotificationsForTests(): void {
  // no-op
}
