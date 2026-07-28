import type { AgentKind } from "@shared/contracts/agent.ts";
import type { AgentHookEventPayload } from "@shared/contracts/agent-session.ts";
import type {
  TranscriptTitleListener,
  TranscriptTitleRecord,
} from "./transcript-title-routing.ts";

/** 一条 transcript 行分类出的可信终态记录。 */
export interface TranscriptTerminalRecord {
  /** 诊断用原生事件名（如 `codex.transcript.turn_aborted`）。 */
  nativeEvent: string;
  pierEvent: "TurnCompleted" | "TurnInterrupted";
  /** provider 无回合身份时为空串（走单 owner + 增量区间回退）。 */
  turnId: string;
}

export interface TranscriptTailReconciler {
  dispose(): void;
  observe(event: AgentHookEventPayload): Promise<void>;
  releasePanel(panelId: string, windowId?: string): void;
  releasePanelsWhere(
    predicate: (panelId: string, windowId: string) => boolean
  ): void;
  releaseWindow(windowId: string): void;
  /** 跨窗口拖拽后把 panel 作用域迁到目标窗口（保留 pending / owner / 回合上下文）。 */
  transferPanelOwnership(input: {
    panelId: string;
    sourceWindowId: string;
    targetWindowId: string;
  }): void;
}

export interface TranscriptTailReconcilerConfig {
  /** 只消费该 agent 的 hook 事件；其他 agent 直接忽略。 */
  agent: AgentKind;
  /**
   * transcript 单行 → 终态记录；非终态行返回 null。可以直接抛错
   * （坏行/格式升级由核心捕获后静默忽略）。
   */
  classifyLine: (line: string) => TranscriptTerminalRecord | null;
  /**
   * transcript 单行 → provider 原生会话名；不是标题行返回 null。
   * 缺席即该 agent 不提供原生标题（静默降级，标题仍走首条 prompt）。
   */
  classifyTitleLine?: (line: string) => TranscriptTitleRecord | null;
  onTerminalEvent: (event: AgentHookEventPayload) => void;
  /** 只在 classifyTitleLine 命中时调用。 */
  onTitleRecord?: TranscriptTitleListener;
  /** transcript 必须位于该根目录内（realpath 后再校验）。 */
  transcriptRoot: string;
}
