import {
  schedulePromptReady,
  viewportHasPaintedPrompt,
} from "./initial-input-gate.ts";
import type { NativeAddon } from "./native-addon.ts";

const INITIAL_INPUT_RETRY_DELAYS_MS = [50, 100, 200, 400, 800] as const;

export function sendInitialTerminalInput(args: {
  addon: NativeAddon;
  initialInput: string | undefined;
  nativePanelId: string;
  onFailed?: () => void;
  panelId: string;
}): void {
  const initialInput = args.initialInput;
  if (!initialInput) {
    return;
  }
  const readViewport = args.addon.readViewportText;
  schedulePromptReady(
    args.panelId,
    () => {
      trySendInitialTerminalInput({ ...args, initialInput }, 0);
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
  args: {
    addon: NativeAddon;
    initialInput: string;
    nativePanelId: string;
    onFailed?: () => void;
    panelId: string;
  },
  attempt: number
): void {
  const sent = args.addon.sendText(args.nativePanelId, args.initialInput);
  if (sent) {
    return;
  }
  const retryDelayMs = INITIAL_INPUT_RETRY_DELAYS_MS[attempt];
  if (retryDelayMs === undefined) {
    console.warn(`[terminal] initial input injection failed: ${args.panelId}`);
    args.onFailed?.();
    return;
  }
  setTimeout(() => {
    trySendInitialTerminalInput(args, attempt + 1);
  }, retryDelayMs);
}

/** Match workspace.addPanelMenu.startAgentFailed / startAgentInjectFailed. */
export function formatAgentCommandInjectFailedCopy(locale: "en" | "zh-CN"): {
  body: string;
  title: string;
} {
  if (locale === "zh-CN") {
    return {
      body: "终端已打开，但没能自动输入启动命令。请在终端里输入，或再启动一次。",
      title: "无法启动智能体，请重试",
    };
  }
  return {
    body: "The terminal opened, but the start command could not be typed. Type it in the terminal, or start the agent again.",
    title: "Couldn't start agent — try again",
  };
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
