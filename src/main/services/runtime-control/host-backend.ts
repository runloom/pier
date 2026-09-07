/** Host-owned terminal control. Exit acknowledgement never destroys a surface. */
import { randomUUID } from "node:crypto";
import { agentKindSchema } from "@shared/contracts/agent.ts";
import type { PierCommandResult } from "@shared/contracts/commands.ts";
import { APPKIT_KEYCODE, GHOSTTY_MODS } from "@shared/terminal-appkit-keys.ts";
import { sendPersistedTerminalInput } from "../../ipc/terminal/drafts/send.ts";
import { getTerminalAddon } from "../../ipc/terminal/index.ts";
import { toNativePanelKey } from "../../ipc/terminal/panel-id.ts";
import {
  type NativeTerminalProcess,
  nativeTerminalProcesses,
} from "../../ipc/terminal/process/registry.ts";
import { stopNativeTerminalProcess } from "../../ipc/terminal/process/stop.ts";
import { findAppWindowForActivityWindowId } from "../../windows/identity.ts";
import type { RuntimeRecord, TerminalBackend } from "./types.ts";

export interface HostTerminalBackendDeps {
  executeCommand(envelope: unknown): Promise<PierCommandResult>;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function nativeKey(windowId: string, panelId: string): string | null {
  const win = findAppWindowForActivityWindowId(windowId);
  return win && !win.isDestroyed() ? toNativePanelKey(win, panelId) : null;
}

export function createHostTerminalBackend(
  deps: HostTerminalBackendDeps
): TerminalBackend {
  const processes = new Map<string, NativeTerminalProcess>();
  function processFor(
    panelId: string,
    runtime?: RuntimeRecord
  ): NativeTerminalProcess | undefined {
    const key = runtime && nativeKey(runtime.windowId, panelId);
    const process = key
      ? nativeTerminalProcesses.get(key)
      : processes.get(panelId);
    if (
      !(process && nativeTerminalProcesses.isCurrent(process)) ||
      process.closed
    )
      return;
    if (runtime?.lifecycleId && process.lifecycleId !== runtime.lifecycleId)
      return;
    // A control-plane generation is not native identity. Only match spawn
    // generation after the host observed a lifecycle id.
    if (
      runtime?.lifecycleId &&
      process.generation !== runtime.runtime.generation
    )
      return;
    return process;
  }

  return {
    async create(args) {
      const agent = agentKindSchema.safeParse(args.agentId);
      if (!agent.success) throw new Error(`unknown agent: ${args.agentId}`);
      const origin = args.origin;
      const result = await deps.executeCommand({
        protocolVersion: 1,
        requestId: randomUUID(),
        clientId: "cli-local",
        command: {
          type: "terminal.open",
          ...(origin
            ? {
                backgroundCreate: true,
                focus: false,
                placement: (
                  {
                    right: "split-right",
                    below: "split-below",
                    tab: "active-tab",
                  } as const
                )[args.placement ?? "tab"],
                ...(args.placement === "right" || args.placement === "below"
                  ? { referencePanelId: origin.panelId }
                  : {}),
              }
            : { focus: true }),
          launch: {
            agentId: agent.data,
            ...(args.cwd ? { cwd: args.cwd } : {}),
          },
          ...(args.windowId ? { windowId: args.windowId } : {}),
          ...(args.promptText === undefined
            ? {}
            : { initialInput: args.promptText }),
        },
      });
      if (!result.ok)
        throw new Error(result.error?.message ?? "terminal.open failed");
      const data = asRecord(result.data);
      const panelId =
        (typeof data?.panelId === "string" ? data.panelId : null) ??
        (typeof data?.id === "string" ? data.id : null);
      const windowId =
        typeof data?.windowId === "string" ? data.windowId : args.windowId;
      if (!(panelId && windowId))
        throw new Error("terminal.open did not return panelId/windowId");
      const key = nativeKey(windowId, panelId);
      const receipt = (p: NativeTerminalProcess) => p.created || p.closed;
      let process = key
        ? await nativeTerminalProcesses.waitFor(key, receipt, 30_000)
        : undefined;
      if (!process && key) {
        const latest = nativeTerminalProcesses.get(key);
        if (latest && receipt(latest)) process = latest;
      }
      if (process?.closed && !process.created)
        throw new Error(process.error ?? "native terminal creation failed");
      if (process) processes.set(panelId, process);
      // Renderer acknowledgement alone is not a native create receipt.
      // Keep the panel locatable and the reservation held if outcome is unknown.
      const processFact = process?.created ? "running" : "unavailable";
      return {
        panelId,
        windowId,
        runtimeId: panelId,
        ...(args.cwd ? { cwd: args.cwd } : {}),
        ...(process
          ? { generation: process.generation, lifecycleId: process.lifecycleId }
          : {}),
        fact: process?.exited ? "exited" : processFact,
        ...(args.promptText === undefined
          ? {}
          : { inputDisposition: process?.inputDisposition ?? "unconfirmed" }),
      };
    },

    async sendText(panelId, text, submit, runtime) {
      const process = processFor(panelId, runtime);
      const addon = getTerminalAddon();
      if (!(process && addon)) return false;
      const needsSubmit = submit ?? /[\r\n]+$/u.test(text);
      let body = text;
      if (needsSubmit) {
        body =
          submit === true
            ? text.replace(/\r?\n$/u, "")
            : text.replace(/[\r\n]+$/u, "");
      }
      const win = findAppWindowForActivityWindowId(
        process.nativePanelId.split("::")[0] ?? ""
      );
      if (!win) return false;
      const result = await sendPersistedTerminalInput({
        addon,
        win,
        panelId,
        submit: needsSubmit,
        text: body,
      });
      if (result.errorCode === "needs-input") throw new Error(result.error);
      if (!result.ok && result.textDelivered)
        throw new Error(
          "text was pasted but submission was not confirmed; check the terminal before sending again"
        );
      return result.ok;
    },

    async readViewport(panelId, runtime) {
      const process = processFor(panelId, runtime);
      const addon = getTerminalAddon();
      if (!(process && addon?.readViewportText)) return null;
      const text = addon.readViewportText(process.nativePanelId);
      if (text === null || text === undefined) return null;
      const lines = text.split("\n");
      return {
        text,
        rows: text.length === 0 ? 0 : lines.length,
        cols: Math.max(0, ...lines.map((line) => line.length)),
      };
    },

    async interrupt(panelId, runtime) {
      const process = processFor(panelId, runtime);
      const addon = getTerminalAddon();
      if (
        !(
          process &&
          addon &&
          nativeTerminalProcesses.inputGuard(process.nativePanelId)()
        )
      )
        return false;
      return addon.sendKeyPress(
        process.nativePanelId,
        APPKIT_KEYCODE.c,
        GHOSTTY_MODS.ctrl,
        "c"
      );
    },

    async terminate(panelId, runtime) {
      const process = processFor(panelId, runtime);
      const addon = getTerminalAddon();
      if (!(process && addon)) return false;
      const result = await stopNativeTerminalProcess(addon, process);
      if (!result.ok) throw new Error(result.error);
      return true;
    },

    async focus(panelId, windowId, runtime) {
      if (!processFor(panelId, runtime)) return false;
      const result = await deps.executeCommand({
        protocolVersion: 1,
        requestId: randomUUID(),
        clientId: "cli-local",
        command: { type: "panel.focus", panelId, windowId, focus: true },
      });
      return result.ok;
    },
  };
}
