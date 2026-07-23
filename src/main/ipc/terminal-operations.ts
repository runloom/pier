import type {
  TerminalOperation,
  TerminalOperationResult,
} from "@shared/contracts/terminal.ts";
import { APPKIT_KEYCODE } from "@shared/terminal-appkit-keys.ts";
import type { AppWindow } from "../windows/app-window.ts";
import type { NativeAddon } from "./terminal-native-addon.ts";
import { toNativePanelKey } from "./terminal-panel-id.ts";

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

export function sendTerminalText(opts: {
  addon: NativeAddon | null;
  args: unknown;
  loadError: string | null;
  win: AppWindow | null;
}): TerminalOperationResult {
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
    const nativePanelId = toNativePanelKey(opts.win, parsed.panelId);
    // sendText 走 clipboard-paste 路径：shell 开了 mode 2004 时整段会被
    // bracketed paste 包裹，末尾拼 \\r 不会真正「按回车」。提交必须拆成
    // paste 文本 + 单独的 Return 键事件；Return 必须带 text="\\r"/
    // unshifted_codepoint，否则部分 agent TUI 只把文本留在输入框。
    const textOk = opts.addon.sendText(nativePanelId, parsed.text);
    if (!textOk) {
      return { ok: false, error: "terminal surface not ready" };
    }
    if (!parsed.submit) {
      return { ok: true };
    }
    const enterOk = opts.addon.sendKeyPress(
      nativePanelId,
      APPKIT_KEYCODE.return,
      0,
      "\r"
    );
    return enterOk
      ? { ok: true }
      : {
          ok: false,
          error: "terminal surface not ready",
          textDelivered: true,
        };
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
