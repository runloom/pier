import { schedulePromptReady } from "./terminal-initial-input-gate.ts";
import type { NativeAddon } from "./terminal-native-addon.ts";

const INITIAL_INPUT_RETRY_DELAYS_MS = [50, 100, 200, 400, 800] as const;

export function sendInitialTerminalInput(args: {
  addon: NativeAddon;
  initialInput: string | undefined;
  nativePanelId: string;
  panelId: string;
}): void {
  const initialInput = args.initialInput;
  if (!initialInput) {
    return;
  }
  // 等 shell 打完登录 banner + 首个 prompt 后再写入 stdin，防止 raw tty echo
  // 把命令字符打在 banner 之前。第一次 OSC 7 (cwd) 事件是 ghostty shell
  // integration 打 prompt 前的钩子，未收到就走 1.5s 后备定时器兜底。
  schedulePromptReady(args.panelId, () => {
    trySendInitialTerminalInput({ ...args, initialInput }, 0);
  });
}

function trySendInitialTerminalInput(
  args: {
    addon: NativeAddon;
    initialInput: string;
    nativePanelId: string;
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
    return;
  }
  setTimeout(() => {
    trySendInitialTerminalInput(args, attempt + 1);
  }, retryDelayMs);
}
