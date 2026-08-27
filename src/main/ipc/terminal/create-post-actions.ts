import type { TaskPanelStatus } from "@shared/contracts/tasks.ts";
import type {
  TerminalInitialInputFailedEvent,
  TerminalInitialInputKind,
} from "@shared/contracts/terminal.ts";
import type { SupportedLocale } from "@shared/i18n/locales.ts";
import {
  cancelPromptReady,
  schedulePromptReady,
  viewportHasPaintedPrompt,
} from "./initial-input-gate.ts";
import type { NativeAddon } from "./native-addon.ts";
import { pasteTerminalText, sendTerminalSubmitReturn } from "./submit-text.ts";
import type { ExitCodeHintArgs } from "./task-lifecycle.ts";

const INITIAL_INPUT_RETRY_DELAYS_MS = [50, 100, 200, 400, 800] as const;

export interface InitialInputInjectFailure {
  textDelivered?: boolean;
}

export function resolveInitialInputFailureAction(input: {
  hasAgent: boolean;
  lifecycleId: string;
  taskStatus: TaskPanelStatus | undefined;
  textDelivered: boolean;
}): {
  completeTask: boolean;
  kind: TerminalInitialInputKind;
} {
  let kind: TerminalInitialInputKind = "setup";
  if (input.hasAgent) {
    kind = "prompt";
  } else if (input.taskStatus) {
    kind = "task";
  }
  return {
    completeTask:
      input.taskStatus === "running" &&
      input.lifecycleId.length > 0 &&
      !input.textDelivered,
    kind,
  };
}

export function handleInitialInputInjectFailed(args: {
  browserWindowId: number;
  completeFromExitCodeHint: (hint: ExitCodeHintArgs) => Promise<boolean>;
  hasAgent: boolean;
  lifecycleId: string;
  panelId: string;
  sendFailed: (event: TerminalInitialInputFailedEvent) => void;
  taskStatus: TaskPanelStatus | undefined;
  textDelivered: boolean;
  windowId?: string | undefined;
}): void {
  const failure = resolveInitialInputFailureAction({
    hasAgent: args.hasAgent,
    lifecycleId: args.lifecycleId,
    taskStatus: args.taskStatus,
    textDelivered: args.textDelivered,
  });
  args.sendFailed({
    kind: failure.kind,
    panelId: args.panelId,
    textDelivered: args.textDelivered,
  });
  if (!failure.completeTask) {
    return;
  }
  args
    .completeFromExitCodeHint({
      browserWindowId: args.browserWindowId,
      code: 1,
      lifecycleId: args.lifecycleId,
      panelId: args.panelId,
      source: "inject-failed",
      ...(args.windowId === undefined ? {} : { windowId: args.windowId }),
    })
    .catch((err) => {
      console.error("[pier-task-lifecycle:inject-failed] failed:", err);
    });
}

interface InitialInputSendArgs {
  addon: NativeAddon;
  generation: number;
  initialInput: string;
  nativePanelId: string;
  onFailed?: (detail?: InitialInputInjectFailure) => void;
  panelId: string;
  submit?: boolean | undefined;
}

interface InjectSession {
  generation: number;
  retryTimer: NodeJS.Timeout | null;
}

const injectSessionByPanelId = new Map<string, InjectSession>();

function sessionFor(panelId: string): InjectSession {
  const existing = injectSessionByPanelId.get(panelId);
  if (existing) {
    return existing;
  }
  const created: InjectSession = { generation: 0, retryTimer: null };
  injectSessionByPanelId.set(panelId, created);
  return created;
}

function isCurrentGeneration(panelId: string, generation: number): boolean {
  return injectSessionByPanelId.get(panelId)?.generation === generation;
}

function clearRetryTimer(session: InjectSession): void {
  if (session.retryTimer) {
    clearTimeout(session.retryTimer);
    session.retryTimer = null;
  }
}

/** 关闭 / 重开 / 转移时作废门控与重试，避免往新 surface 打键或弹出过期失败。 */
export function cancelInitialTerminalInput(panelId: string): void {
  cancelPromptReady(panelId);
  const session = injectSessionByPanelId.get(panelId);
  if (!session) {
    return;
  }
  session.generation += 1;
  clearRetryTimer(session);
}

function resolveInitialInputSubmit(args: InitialInputSendArgs): {
  body: string;
  submit: boolean;
} {
  const trailing = /[\r\n]+$/u.test(args.initialInput);
  const body = trailing
    ? args.initialInput.replace(/[\r\n]+$/u, "")
    : args.initialInput;
  return { body, submit: args.submit !== false };
}

function scheduleInitialInputRetry(
  args: InitialInputSendArgs,
  attempt: number,
  retry: (nextAttempt: number) => void,
  detail?: InitialInputInjectFailure
): void {
  if (!isCurrentGeneration(args.panelId, args.generation)) {
    return;
  }
  const retryDelayMs = INITIAL_INPUT_RETRY_DELAYS_MS[attempt];
  if (retryDelayMs === undefined) {
    console.warn(`[terminal] initial input injection failed: ${args.panelId}`);
    args.onFailed?.(detail);
    return;
  }
  const session = sessionFor(args.panelId);
  clearRetryTimer(session);
  session.retryTimer = setTimeout(() => {
    session.retryTimer = null;
    if (!isCurrentGeneration(args.panelId, args.generation)) {
      return;
    }
    retry(attempt + 1);
  }, retryDelayMs);
}

export function sendInitialTerminalInput(args: {
  addon: NativeAddon;
  initialInput: string | undefined;
  nativePanelId: string;
  onFailed?: (detail?: InitialInputInjectFailure) => void;
  panelId: string;
  submit?: boolean | undefined;
}): void {
  const initialInput = args.initialInput;
  if (!initialInput) {
    return;
  }
  const session = sessionFor(args.panelId);
  session.generation += 1;
  clearRetryTimer(session);
  const generation = session.generation;
  const readViewport = args.addon.readViewportText;
  schedulePromptReady(
    args.panelId,
    () => {
      if (!isCurrentGeneration(args.panelId, generation)) {
        return;
      }
      trySendInitialTerminalInput({ ...args, generation, initialInput }, 0);
    },
    undefined,
    readViewport
      ? {
          isPainted: () =>
            viewportHasPaintedPrompt(readViewport(args.nativePanelId)),
        }
      : {}
  );
}

function trySendInitialTerminalInput(
  args: InitialInputSendArgs,
  attempt: number
): void {
  if (!isCurrentGeneration(args.panelId, args.generation)) {
    return;
  }
  const { body, submit } = resolveInitialInputSubmit(args);
  pasteTerminalText({
    addon: args.addon,
    nativePanelId: args.nativePanelId,
    submit,
    text: body,
  }).then((result) => {
    if (!isCurrentGeneration(args.panelId, args.generation)) {
      return;
    }
    if (result.ok) {
      return;
    }
    if (result.textDelivered) {
      trySendInitialSubmit(args, 0);
      return;
    }
    scheduleInitialInputRetry(args, attempt, (nextAttempt) => {
      trySendInitialTerminalInput(args, nextAttempt);
    });
  });
}

function trySendInitialSubmit(
  args: InitialInputSendArgs,
  attempt: number
): void {
  if (!isCurrentGeneration(args.panelId, args.generation)) {
    return;
  }
  sendTerminalSubmitReturn(args.addon, args.nativePanelId).then((sent) => {
    if (!isCurrentGeneration(args.panelId, args.generation)) {
      return;
    }
    if (sent) {
      return;
    }
    scheduleInitialInputRetry(
      args,
      attempt,
      (nextAttempt) => {
        trySendInitialSubmit(args, nextAttempt);
      },
      { textDelivered: true }
    );
  });
}

/** Match workspace.addPanelMenu.startAgentFailed / startAgentInjectFailed. */
const INJECT_FAILED_COPY: Record<
  SupportedLocale,
  { body: string; title: string }
> = {
  en: {
    body: "The terminal opened, but the start command could not be typed. Type it in the terminal, or start the agent again.",
    title: "Couldn't start agent — try again",
  },
  ja: {
    body: "ターミナルは開きましたが、起動コマンドを入力できませんでした。ターミナルに入力するか、もう一度起動してください。",
    title: "エージェントを起動できませんでした。もう一度お試しください",
  },
  ko: {
    body: "터미널은 열렸지만 시작 명령을 입력하지 못했습니다. 터미널에 직접 입력하거나 에이전트를 다시 시작하세요.",
    title: "에이전트를 시작하지 못했습니다. 다시 시도하세요",
  },
  "zh-CN": {
    body: "终端已打开，但没能自动输入启动命令。请在终端里输入，或再启动一次。",
    title: "无法启动智能体，请重试",
  },
};

export function formatAgentCommandInjectFailedCopy(locale: SupportedLocale): {
  body: string;
  title: string;
} {
  return INJECT_FAILED_COPY[locale];
}

let reportAgentCommandInjectFailedImpl: ((panelId: string) => void) | undefined;

export function setAgentCommandInjectFailedReporter(
  report: ((panelId: string) => void) | undefined
): void {
  reportAgentCommandInjectFailedImpl = report;
}

export function reportAgentCommandInjectFailed(panelId: string): void {
  reportAgentCommandInjectFailedImpl?.(panelId);
}

export async function finishFailedAgentCommandInject(options: {
  readonly clearAgent: () => Promise<void>;
  readonly logError: (err: unknown) => void;
  readonly panelId: string;
  readonly skipClear: boolean;
}): Promise<void> {
  if (!options.skipClear) {
    try {
      await options.clearAgent();
    } catch (err) {
      options.logError(err);
    }
  }
  reportAgentCommandInjectFailed(options.panelId);
}
