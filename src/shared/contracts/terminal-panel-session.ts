import type { AgentKind } from "./agent.ts";
import type { PanelContext, PanelTabChrome } from "./panel.ts";
import type { TaskPanelMetadata } from "./tasks.ts";
import type { TerminalAgentRestoreLaunchOptions } from "./terminal-launch.ts";

export interface TerminalAgentResumeMetadata {
  capturedAt: number;
  sessionId: string;
  source: "hook";
}

export interface TerminalAgentPanelMetadata {
  agentId: AgentKind;
  exitCode?: number | undefined;
  finishedAt?: number | undefined;
  launch: TerminalAgentRestoreLaunchOptions;
  restore?:
    | {
        detachedAt?: number | undefined;
      }
    | undefined;
  resume?: TerminalAgentResumeMetadata | undefined;
  startedAt: number;
  status: "exited" | "running";
}

export interface TerminalPanelSessionSnapshot {
  agent?: TerminalAgentPanelMetadata | undefined;
  context?: PanelContext | undefined;
  /** 产品会话名（≠ OSC title）。 */
  sessionTitle?: string | undefined;
  sessionTitleSource?: "auto" | "user" | undefined;
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
