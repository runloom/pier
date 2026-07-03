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
 */
export interface ForegroundActivityAggregator {
  /**
   * launcher 客户端 / native OSC 133 C 命令行匹配的先验点亮：无需 agent
   * 侧信号即刻建可见 ready 的 agent activity。豁免关闭冷却; 后续 hook
   * 无缝接管。
   */
  agentLaunched(windowId: string, panelId: string, agentId: AgentKind): void;
  consumeIgnoreNativeUserClose(panelId: string): boolean;
  dispose(): void;

  /** launcher/panel 侧的防误关 shim（迁移自老 terminal-task-lifecycle）。 */
  ignoreNextNativeUserClose(panelId: string): void;
  /** Path B 三 kind: agentEvent（真身，聚合器消费驱动 agent activity）。 */
  ingestAgentEvent(event: AgentHookEventPayload): void;
  /** 前台命令退出：panel 内活动清理 + 5s 冷却。Ctrl+Z 悬挂（145-148）保留活动。 */
  ingestCommandFinished(panelId: string, exitCode?: number): void;
  /** Path B 三 kind 占位入口——本 aggregator 不消费, 保 union 完整。 */
  ingestCommandFinishedHook(event: CommandFinishedHookEvent): void;
  /**
   * ghostty shell integration command_started：native 已 embed cmdline，
   * 我们本地做 matchAgentCommand 词元识别; 非空 agent 走 launch 路径，
   * null 覆盖为 shell activity。
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
  /**
   * launcher/panel 侧的 shim：清 `ignoredNativeUserClosePanels` 标记 + 清
   * 该 panel 的冷却记录。**不动 entry 本体**——activity 生命周期由
   * panelClosed / retainPanels 管。命名易歧义, 见 JSDoc。
   */
  resetPanel(panelId: string): void;
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

  /** Task 拉起：用户显式操作优先于 agent, 覆盖 per-panel activity。 */
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
