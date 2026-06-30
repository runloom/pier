import type {
  CreateTerminalArgs,
  TerminalTabChromePatchEvent,
} from "@shared/contracts/terminal.ts";
import {
  patchTerminalPanelTab,
  patchTerminalPanelTaskStatus,
  updateTerminalPanelTab,
} from "../state/terminal-session-state.ts";
import type { AppWindow } from "../windows/app-window.ts";
import { forwardToWindow } from "./terminal-forwarding.ts";
import { terminalSessionScopeFor } from "./terminal-window-scope.ts";

export async function persistInitialTerminalTab(
  sessionScope: string,
  panelId: string,
  tab: CreateTerminalArgs["tab"]
): Promise<void> {
  if (!tab) {
    return;
  }
  try {
    await updateTerminalPanelTab(sessionScope, panelId, tab);
  } catch (err) {
    console.error("[pier-tab-initial-persist] failed:", err);
  }
}

function taskExitTabPatch(
  exitCode: number
): TerminalTabChromePatchEvent["tab"] {
  if (exitCode === 0) {
    return {
      state: {
        colorToken: "success",
        label: "Succeeded",
        status: "succeeded",
      },
    };
  }
  return {
    state: {
      colorToken: "destructive",
      label: `Failed ${exitCode}`,
      status: "failed",
    },
  };
}

export async function forwardTerminalTaskTabPatch(args: {
  browserWindowId: number;
  exitCode: number;
  panelId: string;
  targetWindow: AppWindow | null;
}): Promise<boolean> {
  if (!(args.targetWindow && !args.targetWindow.isDestroyed())) {
    return false;
  }
  const normalizedExitCode = args.exitCode < 0 ? 1 : args.exitCode;
  const patch = taskExitTabPatch(normalizedExitCode);
  const sessionScope = terminalSessionScopeFor(args.targetWindow);
  const status = normalizedExitCode === 0 ? "succeeded" : "failed";
  const patchedTask = await patchTerminalPanelTaskStatus(
    sessionScope,
    args.panelId,
    {
      exitCode: normalizedExitCode,
      finishedAt: Date.now(),
      status,
    }
  );
  if (!patchedTask) {
    return false;
  }
  await patchTerminalPanelTab(sessionScope, args.panelId, patch);
  forwardToWindow(
    args.browserWindowId,
    "pier:terminal:tab-chrome-patch",
    { panelId: args.panelId, tab: patch },
    "pier-task-tab-patch"
  );
  return true;
}
