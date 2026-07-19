import { randomUUID } from "node:crypto";
import type { PierCommandErrorCode } from "@shared/contracts/commands.ts";
import type {
  RendererCommand,
  RendererCommandEnvelope,
  RendererCommandResult,
} from "@shared/contracts/renderer-command.ts";

export interface RendererCommandHost {
  send(
    envelope: RendererCommandEnvelope,
    windowId?: string,
    options?: { focus?: boolean }
  ): number | null;
}

export interface RendererCommandExecuteOptions {
  /** Explicit target window; required for panelTransfer.* (no focused fallback). */
  windowId?: string;
}

export interface RendererCommandService {
  execute(
    command: RendererCommand,
    options?: RendererCommandExecuteOptions
  ): Promise<RendererCommandResult>;
  resolve(result: RendererCommandResult, senderWebContentsId: number): void;
}

export interface CreateRendererCommandServiceArgs {
  createRequestId?: () => string;
  host: RendererCommandHost;
  timeoutMs?: number;
}

interface PendingRequest {
  expectedWebContentsId: number;
  rejectTimer: ReturnType<typeof setTimeout>;
  resolve(result: RendererCommandResult): void;
}

function failure(
  requestId: string,
  message: string,
  code: PierCommandErrorCode = "platform_unavailable"
): RendererCommandResult {
  return {
    error: { code, message },
    ok: false,
    requestId,
  };
}

function rendererCommandTargetWindowId(
  command: RendererCommand,
  options?: RendererCommandExecuteOptions
): string | undefined {
  if (options?.windowId) {
    return options.windowId;
  }
  return "windowId" in command ? command.windowId : undefined;
}

function isPanelTransferRendererCommand(command: RendererCommand): boolean {
  switch (command.type) {
    case "panelTransfer.finalize":
    case "panelTransfer.prepareSource":
    case "panelTransfer.releaseSource":
    case "panelTransfer.stageTarget":
      return true;
    default:
      return false;
  }
}

function shouldFocusRendererWindow(command: RendererCommand): boolean {
  switch (command.type) {
    case "panel.focus":
    case "panel.open":
    case "terminal.open":
      return command.focus ?? true;
    case "panel.close":
    case "panel.list":
    case "panelTransfer.finalize":
    case "panelTransfer.prepareSource":
    case "panelTransfer.releaseSource":
    case "panelTransfer.stageTarget":
    case "plugin.finalizeDisable":
    case "plugin.finalizeReload":
    case "plugin.prepareDisable":
    case "plugin.prepareReload":
    case "workspace.finalizeClose":
    case "workspace.flushLayout":
    case "workspace.prepareClose":
    case "workspace.reportCloseFailure":
      return false;
    default: {
      const _exhaustive: never = command;
      return _exhaustive;
    }
  }
}

export function createRendererCommandService({
  createRequestId = randomUUID,
  host,
  timeoutMs = 15_000,
}: CreateRendererCommandServiceArgs): RendererCommandService {
  const pending = new Map<string, PendingRequest>();

  return {
    execute(command, options) {
      const requestId = createRequestId();
      const envelope: RendererCommandEnvelope = { command, requestId };
      const targetWindowId = rendererCommandTargetWindowId(command, options);
      if (isPanelTransferRendererCommand(command) && !targetWindowId) {
        return Promise.resolve(
          failure(
            requestId,
            "panel transfer renderer command requires windowId",
            "not_found"
          )
        );
      }
      const webContentsId = host.send(envelope, targetWindowId, {
        focus: shouldFocusRendererWindow(command),
      });
      if (webContentsId === null) {
        return Promise.resolve(
          failure(
            requestId,
            "no renderer window available",
            targetWindowId ? "not_found" : "platform_unavailable"
          )
        );
      }
      const { promise, resolve } =
        Promise.withResolvers<RendererCommandResult>();
      const rejectTimer = setTimeout(() => {
        pending.delete(requestId);
        resolve(
          failure(
            requestId,
            "renderer command timed out",
            "platform_unavailable"
          )
        );
      }, timeoutMs);
      pending.set(requestId, {
        expectedWebContentsId: webContentsId,
        rejectTimer,
        resolve,
      });
      return promise;
    },
    resolve(result, senderWebContentsId) {
      const request = pending.get(result.requestId);
      if (!request) {
        return;
      }
      if (request.expectedWebContentsId !== senderWebContentsId) {
        return;
      }
      clearTimeout(request.rejectTimer);
      pending.delete(result.requestId);
      request.resolve(result);
    },
  };
}
