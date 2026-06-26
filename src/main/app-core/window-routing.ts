import type { PierCommandErrorCode } from "@shared/contracts/commands.ts";
import type { WindowInfo } from "@shared/contracts/events.ts";

export interface WindowRoutingServices {
  window: {
    list(): WindowInfo[];
  };
}

export function orderedWindows(windows: readonly WindowInfo[]): WindowInfo[] {
  return [...windows].sort((a, b) => {
    if (a.focused === b.focused) {
      return (b.lastFocusedAt ?? 0) - (a.lastFocusedAt ?? 0);
    }
    return a.focused ? -1 : 1;
  });
}

export function resolveCommandWindow(
  commandWindowId: string | undefined,
  services: WindowRoutingServices,
  options: { requireStableDefault?: boolean } = {}
): { code?: PierCommandErrorCode; error?: string; window?: WindowInfo } {
  const windows = orderedWindows(services.window.list());
  if (commandWindowId) {
    const windowInfo = windows.find(
      (candidate) => candidate.id === commandWindowId
    );
    return windowInfo
      ? { window: windowInfo }
      : { error: `window not found: ${commandWindowId}` };
  }
  if (
    options.requireStableDefault &&
    windows.length > 1 &&
    windows.every((windowInfo) => !windowInfo.focused) &&
    windows.every((windowInfo) => windowInfo.lastFocusedAt === undefined)
  ) {
    return {
      code: "invalid_command",
      error: "multiple background windows available; pass --window",
    };
  }
  const windowInfo = windows[0];
  return windowInfo
    ? { window: windowInfo }
    : { error: "no renderer window available" };
}
