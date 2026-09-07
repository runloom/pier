import type {
  CreateTerminalArgs,
  CreateTerminalResult,
} from "@shared/contracts/terminal.ts";
import type { AppWindow } from "../../../windows/app-window.ts";
import { terminalFocusCoordinator } from "../focus-coordinator.ts";
import type { NativeAddon } from "../native-addon.ts";
import {
  type NativeTerminalProcess,
  nativeTerminalProcesses,
} from "../process/registry.ts";
/** Renderer reload may adopt only an acknowledged physical surface. */
export function adoptTerminalReceipt(
  addon: NativeAddon,
  win: AppWindow,
  args: CreateTerminalArgs,
  process?: NativeTerminalProcess
): CreateTerminalResult | undefined {
  if (!(process?.created && !process.closed && !process.transferring)) return;
  if (
    addon.requestTerminalPresentation({
      nativePanelId: process.nativePanelId,
      presentationId: args.presentationId ?? 0,
    }) === null
  ) {
    nativeTerminalProcesses.closed(process);
    return {
      ok: false,
      error:
        "The terminal is no longer available. Close this tab and start the agent again.",
    };
  }
  terminalFocusCoordinator.surfaceCreated(win, args.panelId);
  return {
    ok: true,
    generation: process.generation,
    lifecycleId: process.lifecycleId,
  };
}
