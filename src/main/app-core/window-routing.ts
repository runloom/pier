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

/** 命令 `windowId` 同时认内部 id（`main`）、`PIER_WINDOW_ID`、record UUID。 */
export function windowInfoMatches(
  windowInfo: WindowInfo,
  commandWindowId: string
): boolean {
  return (
    windowInfo.id === commandWindowId ||
    windowInfo.electronWindowId === commandWindowId ||
    windowInfo.recordId === commandWindowId
  );
}

/**
 * 把命令侧窗口 id 归一化为内部 id（`main` / `w-1`）。
 * 入参同时接受内部 id、`PIER_WINDOW_ID`（Electron id）与 record UUID。
 * 宿主面板快照的 `windowId` 是内部 id；FA / hook 快照沿用 Electron id。
 * 需要与任一种快照严格比较时，两侧都要先过这一层。
 */
export function canonicalWindowId(
  commandWindowId: string | undefined,
  windows: readonly WindowInfo[]
): string | undefined {
  if (!commandWindowId) {
    return;
  }
  const match = windows.find((windowInfo) =>
    windowInfoMatches(windowInfo, commandWindowId)
  );
  return match?.id ?? commandWindowId;
}

export function matchingWindows(
  windows: readonly WindowInfo[],
  commandWindowId: string | undefined
): WindowInfo[] {
  if (!commandWindowId) {
    return [...windows];
  }
  return windows.filter((windowInfo) =>
    windowInfoMatches(windowInfo, commandWindowId)
  );
}

export function resolveCommandWindow(
  commandWindowId: string | undefined,
  services: WindowRoutingServices,
  options: { requireStableDefault?: boolean } = {}
): { code?: PierCommandErrorCode; error?: string; window?: WindowInfo } {
  const windows = orderedWindows(services.window.list());
  if (commandWindowId) {
    const windowInfo = windows.find((candidate) =>
      windowInfoMatches(candidate, commandWindowId)
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
