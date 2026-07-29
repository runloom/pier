import type { TaskRunsSnapshot } from "@shared/contracts/tasks.ts";
import { peekTerminalPanelAgent } from "../../state/terminal-session-store.ts";
import { isBackgroundPanelId } from "./task-background-panel-id.ts";

/**
 * 进程自然退出时是否保留 terminal surface（不自动关 panel）。
 * 任务结果 + 智能体会话结束后都保留，供查看输出；显式关 tab 才收口。
 *
 * `windowId` — task runs owner 键（runtime 窗 id）
 * `sessionWindowId` — terminal-session 作用域（record UUID）；agent peek 用
 */
export function shouldRetainTaskSurfaceOnProcessExit(args: {
  hasDedicatedPanel(panelId: string, windowId?: string | undefined): boolean;
  panelId: string;
  /** window record UUID for agent session lookup */
  sessionWindowId?: string | undefined;
  snapshot: TaskRunsSnapshot;
  windowId?: string | undefined;
}): boolean {
  const { panelId, snapshot, windowId, sessionWindowId } = args;
  if (isBackgroundPanelId(panelId) || panelId.startsWith("task-output-")) {
    return true;
  }
  // Agent session (running or exited) — same result-view policy as tasks.
  if (sessionWindowId && peekTerminalPanelAgent(sessionWindowId, panelId)) {
    return true;
  }
  for (const run of Object.values(snapshot.runs)) {
    for (const node of Object.values(run.nodes)) {
      if (node.panelId === panelId) {
        return true;
      }
    }
  }
  return args.hasDedicatedPanel(panelId, windowId);
}
