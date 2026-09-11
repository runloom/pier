import { taskOutputPanelParamsSchema } from "@shared/contracts/tasks.ts";
import type {
  CreateTerminalArgs,
  CreateTerminalResult,
} from "@shared/contracts/terminal.ts";
import type { AppWindow } from "../../../windows/app-window.ts";
import { findInternalWindowId } from "../../../windows/identity.ts";
import { recordRendererTerminalRoute } from "../debug.ts";
import { terminalFocusCoordinator } from "../focus-coordinator.ts";
import type { NativeAddon } from "../native-addon.ts";
import { toNativePanelKey } from "../panel-id.ts";
import type { TaskOutputTerminalBindings } from "../task/output-bindings.ts";
export async function createTaskOutputTerminal({
  addon,
  createArgs,
  taskOutputBindings,
  win,
}: {
  addon: NativeAddon;
  createArgs: CreateTerminalArgs;
  taskOutputBindings: TaskOutputTerminalBindings | null;
  win: AppWindow;
}): Promise<CreateTerminalResult> {
  const parsed = taskOutputPanelParamsSchema.safeParse(createArgs.taskOutput);
  if (!parsed.success) {
    return { ok: false, error: "invalid task output parameters" };
  }
  if (!taskOutputBindings) {
    return { ok: false, error: "task output service is unavailable" };
  }
  try {
    const nativePanelId = toNativePanelKey(win, createArgs.panelId);
    recordRendererTerminalRoute(win, "create", createArgs.panelId, {
      height: createArgs.frame.height,
      width: createArgs.frame.width,
      x: createArgs.frame.x,
      y: createArgs.frame.y,
    });
    const ok = addon.createOutputTerminal(
      win.getNativeWindowHandle(),
      nativePanelId,
      createArgs.frame,
      createArgs.font.family,
      createArgs.font.size,
      createArgs.presentationId ?? 0
    );
    if (!ok) {
      return { ok: false, error: "createOutputTerminal returned false" };
    }
    const attached = taskOutputBindings.attach({
      browserWindowId: win.id,
      nativePanelId,
      ownerWindowId: findInternalWindowId(win) ?? undefined,
      params: parsed.data,
    });
    if (!attached.ok) {
      terminalFocusCoordinator.surfaceWillClose(win, createArgs.panelId);
      addon.closeTerminal(nativePanelId);
      return {
        ok: false,
        error: attached.error ?? "task output binding failed",
      };
    }
    terminalFocusCoordinator.surfaceCreated(win, createArgs.panelId);
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
