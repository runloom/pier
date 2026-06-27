import type {
  CreateTerminalArgs,
  TerminalTabChromePatchEvent,
} from "@shared/contracts/terminal.ts";
import {
  patchTerminalPanelTab,
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
        busy: false,
        colorToken: "success",
        label: "Succeeded",
      },
    };
  }
  return {
    state: {
      busy: false,
      colorToken: "destructive",
      label: `Failed ${exitCode}`,
    },
  };
}

export function forwardTerminalTaskTabPatch(args: {
  browserWindowId: number;
  exitCode: number;
  panelId: string;
  targetWindow: AppWindow | null;
}): void {
  const patch = taskExitTabPatch(args.exitCode);
  if (args.targetWindow && !args.targetWindow.isDestroyed()) {
    const sessionScope = terminalSessionScopeFor(args.targetWindow);
    patchTerminalPanelTab(sessionScope, args.panelId, patch).catch((err) => {
      console.error("[pier-tab-patch-persist] failed:", err);
    });
  }
  forwardToWindow(
    args.browserWindowId,
    "pier:terminal:tab-chrome-patch",
    { panelId: args.panelId, tab: patch },
    "pier-task-tab-patch"
  );
}
