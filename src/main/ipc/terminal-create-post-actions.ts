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
  trySendInitialTerminalInput({ ...args, initialInput }, 0);
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
