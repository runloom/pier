import type { AgentKind } from "@shared/contracts/agent.ts";
import type {
  AgentHookEventPayload,
  CommandFinishedHookEvent,
  CommandStartHookEvent,
} from "@shared/contracts/agent-session.ts";
import type { ForegroundActivityBroadcast } from "@shared/contracts/foreground-activity.ts";

/**
 * Aggregator 公共 API。native callback、hook observer、task launcher 与 IPC
 * 快照全部经此接口——单入口, 状态归一。
 *
 * 内部为双层模型（见 ./entry.ts）：command 层（OSC/launcher/task）与
 * hook 层（JSONL 事件）独立生灭, 每 panel 投影至多一条 activity。
 */
export interface ForegroundActivityAggregator {
  /**
   * launcher 客户端 / native OSC 133 C 命令行匹配的先验点亮：只建
   * command 层 agent-launch（250ms 消抖后可见, **无 status**——先验只证明
   * 二进制在跑, 会话状态唯 hook 证据可写）。豁免关闭冷却; hook 层独立
   * 接管 status。
   */
  agentLaunched(windowId: string, panelId: string, agentId: AgentKind): void;
  dispose(): void;

  /** Path B 三 kind: agentEvent（真身，聚合器消费驱动 agent activity）。 */
  ingestAgentEvent(event: AgentHookEventPayload): void;
  /**
   * 前台命令退出：双层同清 + 5s 冷却（覆盖崩溃/kill 等无 SessionEnd hook
   * 的路径）。Ctrl+Z 悬挂（145-148）双层保留。
   */
  ingestCommandFinished(panelId: string, exitCode?: number): void;
  /** Path B 三 kind 占位入口——本 aggregator 不消费, 保 union 完整。 */
  ingestCommandFinishedHook(event: CommandFinishedHookEvent): void;
  /**
   * ghostty shell integration command_started：native 已 embed cmdline，
   * 我们本地做 matchAgentCommand 词元识别; 非空 agent 走 agentLaunched，
   * null 只覆盖 command 层为 shell（hook 层不动——`fg` 不摧毁挂起会话）。
   */
  ingestCommandStarted(
    panelId: string,
    windowId: string,
    commandLine: string,
    matchedAgent: AgentKind | null
  ): void;

  /** Path B 三 kind 占位入口——本 aggregator 不消费, 保 union 完整。 */
  ingestCommandStartHook(event: CommandStartHookEvent): void;
  onChange(cb: (b: ForegroundActivityBroadcast) => void): () => void;

  /** panel 关闭 → 清 activity + 冷却拦迟到 hook。 */
  panelClosed(panelId: string): void;
  /** reconcile 对账：该窗口不在 activePanelIds 集合内的活动按 panelClosed 处理。 */
  retainPanels(windowId: string, activePanelIds: readonly string[]): void;

  snapshot(windowId?: string): ForegroundActivityBroadcast;
  /** Task 完成：更新 task activity status + exitCode, 保留 5s linger 后清。 */
  taskFinished(
    panelId: string,
    args: {
      status: "success" | "failure" | "cancelled";
      exitCode?: number;
    }
  ): void;

  /** Task 拉起：用户显式操作优先, 双层全清后建 task 层。 */
  taskLaunched(
    panelId: string,
    windowId: string,
    task: { taskId: string; label: string }
  ): void;
  /** 窗口销毁：清该窗口全部活动（含定时器）+ 冷却记录。 */
  windowClosed(windowId: string): void;
}

export interface ForegroundActivityAggregatorOpts {
  now?: () => number;
}
