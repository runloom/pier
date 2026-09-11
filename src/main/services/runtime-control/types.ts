import type {
  AgentsScreenResult,
  AgentsStartResult,
  AgentsTurnResult,
  AgentsWaitResult,
  AgentsWaitUntil,
  AgentsWatchResult,
} from "@shared/contracts/local-control/agents-runtime.ts";
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
  lifecycleId?: string | undefined;
  panelId: string;
  runtime: RuntimeRef;
  windowId: string;
  worktreeKey?: string | undefined;
}

export interface TerminalBackend {
  create(args: {
    agentId: string;
    promptText?: string | undefined;
    cwd?: string | undefined;
    windowId?: string | undefined;
    /** 委派发起方面板：present 时走后台创建（backgroundCreate + 不抢焦点）。 */
    origin?: { panelId: string; windowId: string } | undefined;
    placement?: "tab" | "right" | "below" | undefined;
  }): Promise<{
    panelId: string;
    windowId: string;
    runtimeId: string;
    generation?: number | undefined;
    lifecycleId?: string | undefined;
    fact?: string | undefined;
    inputDisposition?: "native-launch" | "draft" | "unconfirmed" | undefined;
    cwd?: string | undefined;
  }>;
  focus?(
    panelId: string,
    windowId: string,
    runtime?: RuntimeRecord
  ): Promise<boolean>;
  interrupt(panelId: string, runtime?: RuntimeRecord): Promise<boolean>;
  readViewport(
    panelId: string,
    runtime?: RuntimeRecord
  ): Promise<{
    text: string;
    rows: number;
    cols: number;
  } | null>;
  sendText(
    panelId: string,
    text: string,
    submit?: boolean,
    runtime?: RuntimeRecord
  ): Promise<boolean>;
  terminate(panelId: string, runtime?: RuntimeRecord): Promise<boolean>;
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
  submit?: boolean | undefined;
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

export interface RuntimeControlService {
  focus(input: RuntimeControlTargetInput): Promise<
    RuntimeControlResult<{
      panelId: string;
      windowId: string;
      runtime: RuntimeRef;
    }>
  >;
  interrupt(
    input: RuntimeControlTargetInput
  ): Promise<RuntimeControlResult<{ interrupted: true; runtime: RuntimeRef }>>;
  /** 测试/诊断：当前 boot 内登记数。 */
  listRuntimeIds(): string[];
  /** E11：snapshot.runtimes 投影（摘要，无 screen 全文）。 */
  listRuntimeSummaries(): Array<{
    bootId: string;
    runtimeId: string;
    generation: number;
    agentId: string;
    panelId: string;
    windowId: string;
    fact: string;
    closed: boolean;
    worktreeKey?: string | undefined;
    cwd?: string | undefined;
  }>;
  observeProcess(input: {
    panelId: string;
    windowId: string;
    generation: number;
    lifecycleId: string;
    created?: boolean;
    exited: boolean;
    closed: boolean;
  }): void;
  /**
   * UI 关面板 → 释放：按 panelId 标记 closed 并释放子额占位。
   * 未登记 / 已 closed 的 panelId 静默忽略。
   */
  releaseForPanel(panelId: string): void;
  screen(
    input: RuntimeControlScreenInput
  ): Promise<RuntimeControlResult<AgentsScreenResult>>;
  start(
    input: RuntimeControlStartInput
  ): Promise<RuntimeControlResult<AgentsStartResult>>;
  terminate(
    input: RuntimeControlTargetInput
  ): Promise<RuntimeControlResult<{ terminated: true; runtime: RuntimeRef }>>;
  turn(
    input: RuntimeControlTurnInput
  ): Promise<RuntimeControlResult<AgentsTurnResult>>;
  wait(
    input: RuntimeControlWaitInput
  ): Promise<RuntimeControlResult<AgentsWaitResult>>;
  watch(
    input: RuntimeControlWatchInput
  ): Promise<RuntimeControlResult<AgentsWatchResult>>;
}

export interface CreateRuntimeControlServiceOptions {
  backend: TerminalBackend;
  bootId: string;
  nowMs?: (() => number) | undefined;
  /** UI 关面板释放占额时的回调（ops 层注入 capability-hot-path）。 */
  releaseReservation?: ((runtimeId: string) => void) | undefined;
  /**
   * 解析 wait 谓词。默认：closed → exited；否则 fact 字符串匹配。
   */
  resolveFact?: ((record: RuntimeRecord) => string | undefined) | undefined;
}
