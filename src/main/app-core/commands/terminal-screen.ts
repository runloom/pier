/**
 * terminal.screen / terminal.read：当前 viewport 有界读取。
 * 含 agent 终端；不走 send/key 的 agent 写禁令。
 * W1 `read` 与 `screen` 同实现（viewport only）；滚回待 native/transcript。
 */
import type {
  PierCommand,
  PierCommandResult,
} from "@shared/contracts/commands.ts";
import {
  TERMINAL_SCREEN_DEFAULT_MAX_BYTES,
  TERMINAL_SCREEN_DEFAULT_MAX_LINES,
} from "@shared/contracts/terminal/screen.ts";
import { getTerminalAddon } from "../../ipc/terminal/index.ts";
import { clampScreenText } from "../../services/runtime-control/screen-text.ts";
import {
  commandFailure as failure,
  commandSuccess as success,
} from "../command-results.ts";
import type { PierCoreServices } from "../command-router-services.ts";
import { requireTerminalPanel, resolveNativeKey } from "./terminal-locate.ts";

type TerminalViewportReadCommand = Extract<
  PierCommand,
  { type: "terminal.screen" | "terminal.read" }
>;

function viewportCols(raw: string): number {
  const lines = raw.split("\n");
  return Math.max(0, ...lines.map((line) => line.length));
}

export async function executeTerminalViewportRead(
  requestId: string,
  command: TerminalViewportReadCommand,
  services: PierCoreServices
): Promise<PierCommandResult> {
  const found = await requireTerminalPanel(
    requestId,
    command.panelId,
    command.windowId,
    services
  );
  if (!found.ok) {
    return found.result;
  }
  const maxLines = command.maxLines ?? TERMINAL_SCREEN_DEFAULT_MAX_LINES;
  const maxBytes = command.maxBytes ?? TERMINAL_SCREEN_DEFAULT_MAX_BYTES;
  const key = resolveNativeKey(command.panelId, found.panel.windowId);
  const addon = getTerminalAddon();
  if (!(key && addon)) {
    return failure(
      requestId,
      "platform_unavailable",
      "terminal native backend unavailable"
    );
  }
  if (!addon.readViewportText) {
    return failure(
      requestId,
      "platform_unavailable",
      "terminal viewport read is unavailable"
    );
  }
  const raw = addon.readViewportText(key) ?? "";
  const clamped = clampScreenText(raw, maxLines, maxBytes);
  return success(requestId, {
    capturedAt: Date.now(),
    cols: viewportCols(raw),
    maxBytes,
    maxLines,
    panelId: found.panel.id,
    rows: clamped.rows,
    scope: "viewport" as const,
    text: clamped.text,
    truncated: clamped.truncated,
    windowId: found.panel.windowId,
  });
}

export const executeTerminalScreenCommand = executeTerminalViewportRead;
/** W1：与 screen 同为 viewport；`-S` 滚回待 native/transcript，不假装有 scrollback。 */
export const executeTerminalReadCommand = executeTerminalViewportRead;
