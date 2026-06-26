import type {
  TerminalOperation,
  TerminalOperationResult,
} from "@shared/contracts/terminal.ts";
import type { AppWindow } from "../windows/app-window.ts";
import type { NativeAddon } from "./terminal-native-addon.ts";
import { scopePanelId } from "./terminal-panel-id.ts";

const TERMINAL_OPERATION_BINDINGS: Record<TerminalOperation, string> = {
  clearScreen: "clear_screen",
  copy: "copy_to_clipboard",
  paste: "paste_from_clipboard",
  selectAll: "select_all",
};

function isTerminalOperation(value: unknown): value is TerminalOperation {
  return (
    value === "copy" ||
    value === "paste" ||
    value === "selectAll" ||
    value === "clearScreen"
  );
}

export function performTerminalOperation(opts: {
  addon: NativeAddon | null;
  loadError: string | null;
  operation: unknown;
  panelId: unknown;
  win: AppWindow | null;
}): TerminalOperationResult {
  if (!opts.addon) {
    return { ok: false, error: opts.loadError ?? "native addon not loaded" };
  }
  if (typeof opts.panelId !== "string" || opts.panelId === "") {
    return { ok: false, error: "invalid panel id" };
  }
  if (!isTerminalOperation(opts.operation)) {
    return { ok: false, error: "invalid terminal operation" };
  }
  if (!opts.win) {
    return { ok: false, error: "window not found" };
  }
  try {
    const ok = opts.addon.performTerminalBindingAction(
      scopePanelId(opts.win, opts.panelId),
      TERMINAL_OPERATION_BINDINGS[opts.operation]
    );
    return ok
      ? { ok: true }
      : { ok: false, error: "terminal operation failed" };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
