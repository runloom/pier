import type { AgentKind } from "../agent.ts";
import type { AgentSessionTitleSource } from "../foreground-activity.ts";
import type { PanelContext, PanelTabChrome } from "../panel.ts";
import type { TaskPanelMetadata } from "../tasks.ts";
import type { TerminalAgentRestoreLaunchOptions } from "./launch.ts";

export interface TerminalAgentResumeMetadata {
  capturedAt: number;
  sessionId: string;
  source: "hook";
}

/** Host tore down the PTY; conversation still belongs to the agent. */
export type TerminalAgentRestoreCause = "host-teardown" | "resume-failed";

export interface TerminalAgentRestoreMetadata {
  cause?: TerminalAgentRestoreCause | undefined;
  detachedAt?: number | undefined;
  /**
   * True while this spawn is a pinned `--resume` that has not yet been
   * confirmed (matching SessionStart) or unlocked (PromptSubmit).
   */
  resumePending?: boolean | undefined;
  spawnGeneration?: number | undefined;
}

export interface TerminalAgentPanelMetadata {
  agentId: AgentKind;
  exitCode?: number | undefined;
  finishedAt?: number | undefined;
  launch: TerminalAgentRestoreLaunchOptions;
  restore?: TerminalAgentRestoreMetadata | undefined;
  resume?: TerminalAgentResumeMetadata | undefined;
  startedAt: number;
  status: "exited" | "running";
}

export interface TerminalPanelSessionSnapshot {
  agent?: TerminalAgentPanelMetadata | undefined;
  context?: PanelContext | undefined;
  /** 产品会话名（≠ OSC title）。 */
  sessionTitle?: string | undefined;
  /** 标题所属的 provider 主会话；仅用于跨 SessionStart 保持正确归属。 */
  sessionTitleSessionId?: string | undefined;
  sessionTitleSource?: AgentSessionTitleSource | undefined;
  tab?: PanelTabChrome | undefined;
  task?: TaskPanelMetadata | undefined;
  /**
   * main 担保的 task 活性：该 panel 的 task 面板寿命仍在本 main 进程内
   * （foreground-activity 有 task slot——running 或终态常驻）。true = renderer
   * reload 重挂路径（native 面保留, 渲染真终端）；false/缺席 = app restart,
   * 渲染静态结果卡。
   */
  taskLive?: boolean | undefined;
  title?: string | undefined;
  updatedAt: string;
}
