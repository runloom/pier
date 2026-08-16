/**
 * 真实 terminal 后端：start → terminal.open + agent launch；
 * turn/stop/screen → native addon（按 windowId 拼 native panel key）。
 */
import { randomUUID } from "node:crypto";
import type { AgentKind } from "@shared/contracts/agent.ts";
import { agentKindSchema } from "@shared/contracts/agent.ts";
import type { PierCommandResult } from "@shared/contracts/commands.ts";
import { getTerminalAddon } from "../../ipc/terminal/index.ts";
import { toNativePanelKey } from "../../ipc/terminal/panel-id.ts";
import { findAppWindowForActivityWindowId } from "../../windows/identity.ts";
import type { TerminalBackend } from "./types.ts";

export interface HostTerminalBackendDeps {
  executeCommand(envelope: unknown): Promise<PierCommandResult>;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return null;
}

function parseAgentKind(agentId: string): AgentKind | null {
  const parsed = agentKindSchema.safeParse(agentId);
  return parsed.success ? parsed.data : null;
}

function nativeKey(windowId: string, panelId: string): string | null {
  const win = findAppWindowForActivityWindowId(windowId);
  if (!win || win.isDestroyed()) {
    return null;
  }
  return toNativePanelKey(win, panelId);
}

/** 与 ipc/terminal/operations.ts 一致：paste 与 Return 拆次 read。 */
const SUBMIT_ENTER_SETTLE_MS = 100;

export function createHostTerminalBackend(
  deps: HostTerminalBackendDeps
): TerminalBackend {
  /** panelId → windowId */
  const windows = new Map<string, string>();
  /** per-native-key send serial queue */
  const sendQueues = new Map<string, Promise<unknown>>();

  function enqueueSend<T>(key: string, task: () => Promise<T>): Promise<T> {
    const prev = sendQueues.get(key) ?? Promise.resolve();
    const next = prev.then(task, task);
    sendQueues.set(
      key,
      next.then(
        () => undefined,
        () => undefined
      )
    );
    return next;
  }

  return {
    async create(args) {
      const agentId = parseAgentKind(args.agentId);
      if (!agentId) {
        throw new Error(`unknown agent: ${args.agentId}`);
      }
      const requestId = randomUUID();
      const result = await deps.executeCommand({
        protocolVersion: 1,
        requestId,
        clientId: "cli-local",
        command: {
          type: "terminal.open",
          focus: true,
          launch: {
            agentId,
            ...(args.cwd ? { cwd: args.cwd } : {}),
          },
          ...(args.windowId ? { windowId: args.windowId } : {}),
        },
      });
      if (!result.ok) {
        throw new Error(result.error?.message ?? "terminal.open failed");
      }
      const data = asRecord(result.data);
      let panelId: string | null = null;
      if (typeof data?.panelId === "string") {
        panelId = data.panelId;
      } else if (typeof data?.id === "string") {
        panelId = data.id;
      }
      const windowId =
        typeof data?.windowId === "string" ? data.windowId : args.windowId;
      if (!(panelId && windowId)) {
        throw new Error("terminal.open did not return panelId/windowId");
      }
      windows.set(panelId, windowId);
      return {
        panelId,
        windowId,
        runtimeId: panelId,
        ...(args.cwd ? { cwd: args.cwd } : {}),
      };
    },

    async sendText(panelId, text) {
      const windowId = windows.get(panelId);
      if (!windowId) {
        return false;
      }
      const key = nativeKey(windowId, panelId);
      const addon = getTerminalAddon();
      if (!(key && addon)) {
        return false;
      }
      // Bracketed paste: trailing \r/\n inside sendText often does not submit.
      // Strip trailing newline(s), paste body, settle, then synthetic Return.
      const needsSubmit = /[\r\n]+$/u.test(text);
      const body = needsSubmit ? text.replace(/[\r\n]+$/u, "") : text;
      return enqueueSend(key, async () => {
        if (body.length > 0) {
          const ok = addon.sendText(key, body);
          if (!ok) {
            return false;
          }
        }
        if (!needsSubmit) {
          return true;
        }
        await new Promise((resolve) =>
          setTimeout(resolve, SUBMIT_ENTER_SETTLE_MS)
        );
        if (typeof addon.sendKeyPress === "function") {
          return addon.sendKeyPress(key, 0x24, 0, "\r");
        }
        return addon.sendText(key, "\r");
      });
    },

    async readViewport(panelId) {
      const windowId = windows.get(panelId);
      if (!windowId) {
        return null;
      }
      const key = nativeKey(windowId, panelId);
      const addon = getTerminalAddon();
      if (!(key && addon)) {
        return null;
      }
      if (!addon.readViewportText) {
        // 旧 native 无此符号：显式失败，避免「空屏成功」误导升级
        return null;
      }
      const text = addon.readViewportText(key) ?? "";
      const lines = text.split("\n");
      return {
        text,
        rows: text.length === 0 ? 0 : lines.length,
        cols: Math.max(0, ...lines.map((line) => line.length)),
      };
    },

    async interrupt(panelId) {
      const windowId = windows.get(panelId);
      if (!windowId) {
        return false;
      }
      const key = nativeKey(windowId, panelId);
      const addon = getTerminalAddon();
      if (!(key && addon)) {
        return false;
      }
      return addon.sendText(key, "\u0003");
    },

    async terminate(panelId) {
      const windowId = windows.get(panelId);
      if (!windowId) {
        return false;
      }
      const key = nativeKey(windowId, panelId);
      const addon = getTerminalAddon();
      if (!(key && addon)) {
        return false;
      }
      const ok = addon.closeTerminal(key);
      if (ok) {
        windows.delete(panelId);
      }
      return ok;
    },

    async focus(panelId, windowId) {
      windows.set(panelId, windowId);
      const result = await deps.executeCommand({
        protocolVersion: 1,
        requestId: randomUUID(),
        clientId: "cli-local",
        command: {
          type: "panel.focus",
          panelId,
          windowId,
          focus: true,
        },
      });
      return result.ok;
    },
  };
}
