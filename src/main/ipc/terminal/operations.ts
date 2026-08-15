import type {
  TerminalCursorVisibility,
  TerminalOperation,
  TerminalOperationResult,
} from "@shared/contracts/terminal.ts";
import type { AppWindow } from "../../windows/app-window.ts";
import type { NativeAddon } from "./native-addon.ts";
import { toNativePanelKey } from "./panel-id.ts";
import { pasteTerminalText } from "./submit-text.ts";

export { SUBMIT_ENTER_SETTLE_MS } from "./submit-text.ts";

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

export function readTerminalSelectionText(opts: {
  addon: NativeAddon | null;
  loadError: string | null;
  panelId: string;
  win: AppWindow;
}): string | null {
  if (!opts.addon) {
    throw new Error(opts.loadError ?? "native addon not loaded");
  }
  const text = opts.addon.readSelectionText(
    toNativePanelKey(opts.win, opts.panelId)
  );
  return text && text.length > 0 ? text : null;
}

/** TUI 输入聚焦探针（DECTCEM ?25）；任何不可用一律归 unknown，不抛出。 */
export function readTerminalCursorVisibility(opts: {
  addon: NativeAddon | null;
  panelId: unknown;
  win: AppWindow | null;
}): TerminalCursorVisibility {
  if (!(opts.addon && opts.win)) {
    return "unknown";
  }
  if (typeof opts.panelId !== "string" || opts.panelId === "") {
    return "unknown";
  }
  try {
    const value = opts.addon.readCursorVisible(
      toNativePanelKey(opts.win, opts.panelId)
    );
    if (value === 1) {
      return "visible";
    }
    if (value === 0) {
      return "hidden";
    }
    return "unknown";
  } catch {
    return "unknown";
  }
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
      toNativePanelKey(opts.win, opts.panelId),
      TERMINAL_OPERATION_BINDINGS[opts.operation]
    );
    return ok
      ? { ok: true }
      : { ok: false, error: "terminal operation failed" };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/** 对齐 renderer-command.ts 中 terminal.open initialInput 的 64k 上限。 */
const MAX_SEND_TEXT_LENGTH = 64_000;

interface ParsedSendTextArgs {
  panelId: string;
  submit: boolean;
  text: string;
}

interface ParsedSendKeyPressArgs {
  keycode: number;
  mods: number;
  panelId: string;
  text?: string | undefined;
}

function parseSendTextArgs(value: unknown): ParsedSendTextArgs | null {
  if (typeof value !== "object" || value === null) {
    return null;
  }
  const record = value as Record<string, unknown>;
  if (typeof record.panelId !== "string" || record.panelId === "") {
    return null;
  }
  if (
    typeof record.text !== "string" ||
    record.text.length === 0 ||
    record.text.length > MAX_SEND_TEXT_LENGTH
  ) {
    return null;
  }
  if (record.submit !== undefined && typeof record.submit !== "boolean") {
    return null;
  }
  return {
    panelId: record.panelId,
    submit: record.submit === true,
    text: record.text,
  };
}

function parseSendKeyPressArgs(value: unknown): ParsedSendKeyPressArgs | null {
  if (typeof value !== "object" || value === null) {
    return null;
  }
  const record = value as Record<string, unknown>;
  if (typeof record.panelId !== "string" || record.panelId === "") {
    return null;
  }
  if (typeof record.keycode !== "number" || !Number.isInteger(record.keycode)) {
    return null;
  }
  if (record.keycode < 0 || record.keycode > 0xff) {
    return null;
  }
  if (record.mods !== undefined) {
    if (typeof record.mods !== "number" || !Number.isInteger(record.mods)) {
      return null;
    }
    if (record.mods < 0 || record.mods > 0xff_ff) {
      return null;
    }
  }
  if (
    record.text !== undefined &&
    (typeof record.text !== "string" || record.text.length > 16)
  ) {
    return null;
  }
  return {
    keycode: record.keycode,
    mods: typeof record.mods === "number" ? record.mods : 0,
    panelId: record.panelId,
    ...(typeof record.text === "string" ? { text: record.text } : {}),
  };
}

export async function sendTerminalText(opts: {
  addon: NativeAddon | null;
  args: unknown;
  loadError: string | null;
  win: AppWindow | null;
}): Promise<TerminalOperationResult> {
  if (!opts.addon) {
    return { ok: false, error: opts.loadError ?? "native addon not loaded" };
  }
  const parsed = parseSendTextArgs(opts.args);
  if (!parsed) {
    return { ok: false, error: "invalid send text args" };
  }
  if (!opts.win) {
    return { ok: false, error: "window not found" };
  }
  try {
    return await pasteTerminalText({
      addon: opts.addon,
      nativePanelId: toNativePanelKey(opts.win, parsed.panelId),
      submit: parsed.submit,
      text: parsed.text,
    });
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export function sendTerminalKeyPress(opts: {
  addon: NativeAddon | null;
  args: unknown;
  loadError: string | null;
  win: AppWindow | null;
}): TerminalOperationResult {
  if (!opts.addon) {
    return { ok: false, error: opts.loadError ?? "native addon not loaded" };
  }
  const parsed = parseSendKeyPressArgs(opts.args);
  if (!parsed) {
    return { ok: false, error: "invalid send key press args" };
  }
  if (!opts.win) {
    return { ok: false, error: "window not found" };
  }
  try {
    const nativePanelId = toNativePanelKey(opts.win, parsed.panelId);
    const ok =
      parsed.text === undefined
        ? opts.addon.sendKeyPress(nativePanelId, parsed.keycode, parsed.mods)
        : opts.addon.sendKeyPress(
            nativePanelId,
            parsed.keycode,
            parsed.mods,
            parsed.text
          );
    return ok
      ? { ok: true }
      : { ok: false, error: "terminal surface not ready" };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
