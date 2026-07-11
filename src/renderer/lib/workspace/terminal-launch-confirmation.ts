const TERMINAL_LAUNCH_CONFIRMATION_TIMEOUT_MS = 4500;

interface PendingTerminalLaunch {
  reject(error: Error): void;
  resolve(): void;
  timer: number;
}

const pendingLaunches = new Map<string, PendingTerminalLaunch>();

function launchError(message: string | Error): Error {
  return message instanceof Error ? message : new Error(message);
}

export function waitForTerminalLaunch(launchId: string): Promise<void> {
  const existing = pendingLaunches.get(launchId);
  if (existing) {
    existing.reject(new Error(`terminal launch already pending: ${launchId}`));
    window.clearTimeout(existing.timer);
    pendingLaunches.delete(launchId);
  }

  return new Promise<void>((resolve, reject) => {
    const timer = window.setTimeout(() => {
      pendingLaunches.delete(launchId);
      reject(new Error("terminal creation timed out"));
    }, TERMINAL_LAUNCH_CONFIRMATION_TIMEOUT_MS);
    pendingLaunches.set(launchId, {
      reject,
      resolve,
      timer,
    });
  });
}

export function confirmTerminalLaunch(launchId: string | undefined): void {
  if (!launchId) {
    return;
  }
  const pending = pendingLaunches.get(launchId);
  if (!pending) {
    return;
  }
  window.clearTimeout(pending.timer);
  pendingLaunches.delete(launchId);
  pending.resolve();
}

export function rejectTerminalLaunch(
  launchId: string | undefined,
  error: string | Error
): void {
  if (!launchId) {
    return;
  }
  const pending = pendingLaunches.get(launchId);
  if (!pending) {
    return;
  }
  window.clearTimeout(pending.timer);
  pendingLaunches.delete(launchId);
  pending.reject(launchError(error));
}

export function resetTerminalLaunchConfirmationsForTest(): void {
  for (const pending of pendingLaunches.values()) {
    window.clearTimeout(pending.timer);
  }
  pendingLaunches.clear();
}
