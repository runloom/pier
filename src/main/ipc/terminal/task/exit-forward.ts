import type {
  NativeProcessRegistry,
  NativeTerminalProcess,
} from "../process/registry.ts";

export function isDismissingTerminal(
  process: NativeTerminalProcess | undefined
): boolean {
  return Boolean(process?.closing || process?.closed);
}

export function recordNativeProcessExit(
  registry: NativeProcessRegistry,
  process: NativeTerminalProcess | undefined,
  fallbackNativePanelId: string,
  lifecycleId: string,
  exitCode?: number
): void {
  registry.exited(
    process?.nativePanelId ?? fallbackNativePanelId,
    lifecycleId,
    exitCode
  );
}

/** Keep the Dockview tab: explicit close owns teardown; stop/agent/task keep output. */
export function shouldKeepTerminalTabOnProcessExit(input: {
  hadAgentPresence: boolean;
  isAgentSurface: boolean;
  isTaskSurface: boolean;
  process: NativeTerminalProcess | undefined;
  shouldRetainFromOwner: boolean;
}): boolean {
  return (
    isDismissingTerminal(input.process) ||
    input.process?.stopping === true ||
    input.isAgentSurface ||
    input.isTaskSurface ||
    input.hadAgentPresence ||
    input.shouldRetainFromOwner
  );
}
