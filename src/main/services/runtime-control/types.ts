import type { AgentsWaitUntil } from "@shared/contracts/local-control/agents-runtime.ts";
import type { LocalControlErrorCode } from "@shared/contracts/local-control/errors.ts";
import type { RuntimeRef } from "@shared/contracts/local-control/runtime-ref.ts";

export type {
  AgentsScreenResult,
  AgentsStartResult,
  AgentsTurnResult,
  AgentsWaitResult,
} from "@shared/contracts/local-control/agents-runtime.ts";

export interface RuntimeRecord {
  agentId: string;
  agentRef?: string | undefined;
  closed: boolean;
  cwd?: string | undefined;
  /** 运行事实投影；非工作完成。 */
  fact: string;
  incarnationId?: string | undefined;
  panelId: string;
  runtime: RuntimeRef;
  windowId: string;
  worktreeKey?: string | undefined;
}

export interface TerminalBackend {
  create(args: {
    agentId: string;
    cwd?: string | undefined;
    windowId?: string | undefined;
    /** 委派发起方面板：present 时走后台创建（backgroundCreate + 不抢焦点）。 */
    origin?: { panelId: string; windowId: string } | undefined;
    placement?: "tab" | "right" | "below" | undefined;
  }): Promise<{
    panelId: string;
    windowId: string;
    runtimeId: string;
    cwd?: string | undefined;
  }>;
  /**
   * 首轮 prompt 投递：等面板就绪（OSC7/painted）后 paste + Enter。
   * 返回 false 表示总预算内未投出（调用方负责回滚清理）。
   */
  deliverInitialPrompt(panelId: string, text: string): Promise<boolean>;
  focus?(panelId: string, windowId: string): Promise<boolean>;
  interrupt(panelId: string): Promise<boolean>;
  readViewport(panelId: string): Promise<{
    text: string;
    rows: number;
    cols: number;
  } | null>;
  sendText(panelId: string, text: string): Promise<boolean>;
  terminate(panelId: string): Promise<boolean>;
}

export interface RuntimeControlOk<T> {
  data: T;
  ok: true;
}
export interface RuntimeControlErr {
  code: LocalControlErrorCode;
  message: string;
  ok: false;
}
export type RuntimeControlResult<T> = RuntimeControlOk<T> | RuntimeControlErr;

export interface RuntimeControlStartInput {
  agentId: string;
  cwd?: string | undefined;
  incarnationId?: string | undefined;
  originAgentKind?: string | undefined;
  originPanelId?: string | undefined;
  placement?: "tab" | "right" | "below" | undefined;
  promptText?: string | undefined;
  windowId?: string | undefined;
  worktreeKey?: string | undefined;
}

export interface RuntimeControlTargetInput {
  bootId: string;
  generation: number;
  runtimeId: string;
}

export interface RuntimeControlTurnInput extends RuntimeControlTargetInput {
  text: string;
}

export interface RuntimeControlScreenInput extends RuntimeControlTargetInput {
  maxBytes: number;
  maxLines: number;
}

export interface RuntimeControlWaitInput extends RuntimeControlTargetInput {
  nowMs?: (() => number) | undefined;
  signal?: AbortSignal | undefined;
  sleepMs?: ((ms: number, signal?: AbortSignal) => Promise<void>) | undefined;
  timeoutMs?: number | undefined;
  until: AgentsWaitUntil;
}

export interface RuntimeControlWatchInput extends RuntimeControlTargetInput {
  nowMs?: (() => number) | undefined;
  onSample?:
    | ((sample: { fact: string; ts: number; runtime: RuntimeRef }) => void)
    | undefined;
  pollMs?: number | undefined;
  signal?: AbortSignal | undefined;
  sleepMs?: ((ms: number, signal?: AbortSignal) => Promise<void>) | undefined;
  timeoutMs?: number | undefined;
}
