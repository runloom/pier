import type { TerminalOperationResult } from "@shared/contracts/terminal.ts";
import type { NativeAddon } from "../native-addon.ts";
import {
  type NativeProcessRegistry,
  type NativeTerminalProcess,
  nativeTerminalProcesses,
} from "./registry.ts";

const pendingStops = new WeakMap<
  NativeTerminalProcess,
  Promise<TerminalOperationResult>
>();

/** Signals the owned process; only a native exit receipt completes the stop. */
export function stopNativeTerminalProcess(
  addon: Pick<NativeAddon, "signalTerminalProcess">,
  process: NativeTerminalProcess,
  registry: NativeProcessRegistry = nativeTerminalProcesses
): Promise<TerminalOperationResult> {
  if (!registry.isCurrent(process) || process.closed)
    return Promise.resolve({
      ok: false,
      error: "terminal process changed or unavailable",
    });
  if (process.exited) return Promise.resolve({ ok: true });
  const pending = pendingStops.get(process);
  if (pending) return pending;
  if (!addon.signalTerminalProcess)
    return Promise.resolve({
      ok: false,
      error:
        "stop-and-retain unsupported by native addon; rebuild or update Pier",
    });
  if (!process.created)
    return Promise.resolve({
      ok: false,
      error: "terminal process creation not confirmed",
    });
  process.stopping = true;
  const request = new Promise<TerminalOperationResult>((resolve) => {
    let finished = false;
    const finish = (result: TerminalOperationResult) => {
      if (finished) return;
      finished = true;
      clearTimeout(escalation);
      clearTimeout(timeout);
      unsubscribe();
      resolve(result);
    };
    const check = () => {
      if (!registry.isCurrent(process) || process.closed)
        finish({ ok: false, error: "terminal process changed while stopping" });
      else if (process.exited) finish({ ok: true });
    };
    const signal = (force: boolean) => {
      if (!registry.isCurrent(process) || process.closed || process.exited) {
        check();
        return;
      }
      try {
        if (
          !addon.signalTerminalProcess?.(
            process.nativePanelId,
            process.lifecycleId,
            force
          )
        )
          finish({ ok: false, error: "native terminal rejected stop request" });
      } catch (error) {
        finish({
          ok: false,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    };
    const unsubscribe = registry.subscribe(check);
    const escalation = setTimeout(() => signal(true), 2000);
    const timeout = setTimeout(
      () =>
        finish({
          ok: false,
          error:
            "timed out waiting for process exit; output retained, retry stop to check again",
        }),
      10_000
    );
    signal(false);
  });
  pendingStops.set(process, request);
  request.then(() => pendingStops.delete(process));
  return request;
}

/**
 * Fire a stop signal without waiting for an exit receipt.
 * Explicit tab close uses this so Dockview is not blocked on TERM/KILL grace.
 */
export function signalNativeTerminalProcess(
  addon: Pick<NativeAddon, "signalTerminalProcess">,
  process: NativeTerminalProcess,
  force: boolean,
  registry: NativeProcessRegistry = nativeTerminalProcesses
): boolean {
  if (!registry.isCurrent(process) || process.closed || process.exited) {
    return process.exited === true;
  }
  if (!addon.signalTerminalProcess) return false;
  try {
    return (
      addon.signalTerminalProcess(
        process.nativePanelId,
        process.lifecycleId,
        force
      ) === true
    );
  } catch {
    return false;
  }
}
