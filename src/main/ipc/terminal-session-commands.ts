import type {
  TerminalFocusSessionArgs,
  TerminalOpenSessionArgs,
  TerminalSessionCommandResult,
} from "@shared/contracts/terminal.ts";
import type { IpcMain } from "electron";
import { appCore } from "../app-core/app-core.ts";
import { listTerminalSessions } from "../app-core/command-router.ts";

function commandResult(
  ok: boolean,
  data: unknown,
  fallbackWindowId?: string
): TerminalSessionCommandResult {
  if (!ok) {
    const error =
      data && typeof data === "object" && "message" in data
        ? String(data.message)
        : "terminal command failed";
    return { error, ok: false };
  }
  if (!data || typeof data !== "object") {
    return {
      ok: true,
      ...(fallbackWindowId ? { windowId: fallbackWindowId } : {}),
    };
  }
  const record = data as Record<string, unknown>;
  const panelId =
    typeof record.panelId === "string" ? record.panelId : undefined;
  const windowId =
    typeof record.windowId === "string" ? record.windowId : fallbackWindowId;
  return {
    ok: true,
    ...(panelId ? { panelId } : {}),
    ...(windowId ? { windowId } : {}),
  };
}

export function registerTerminalSessionIpc(ipcMain: IpcMain): void {
  ipcMain.handle(
    "pier:terminal:list-sessions",
    async (_event, args?: { windowId?: string }) =>
      await listTerminalSessions(
        {
          type: "terminal.list",
          ...(args?.windowId ? { windowId: args.windowId } : {}),
        },
        appCore.services
      )
  );

  ipcMain.handle(
    "pier:terminal:focus-session",
    async (
      _event,
      args: TerminalFocusSessionArgs
    ): Promise<TerminalSessionCommandResult> => {
      const result = await appCore.services.rendererCommand.execute({
        type: "terminal.focus",
        panelId: args.panelId,
        ...(args.focus === undefined ? {} : { focus: args.focus }),
        ...(args.windowId ? { windowId: args.windowId } : {}),
      });
      return result.ok
        ? commandResult(true, result.data, args.windowId)
        : commandResult(false, result.error);
    }
  );

  ipcMain.handle(
    "pier:terminal:open-session",
    async (
      _event,
      args?: TerminalOpenSessionArgs
    ): Promise<TerminalSessionCommandResult> => {
      const result = await appCore.services.rendererCommand.execute({
        type: "terminal.open",
        ...(args?.cwd ? { cwd: args.cwd } : {}),
        ...(args?.focus === undefined ? {} : { focus: args.focus }),
        ...(args?.placement ? { placement: args.placement } : {}),
        ...(args?.windowId ? { windowId: args.windowId } : {}),
      });
      return result.ok
        ? commandResult(true, result.data, args?.windowId)
        : commandResult(false, result.error);
    }
  );
}
