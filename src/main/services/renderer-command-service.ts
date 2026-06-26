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
  ): boolean;
}

export interface RendererCommandService {
  execute(command: RendererCommand): Promise<RendererCommandResult>;
  resolve(result: RendererCommandResult): void;
}

export interface CreateRendererCommandServiceArgs {
  createRequestId?: () => string;
  host: RendererCommandHost;
  timeoutMs?: number;
}

interface PendingRequest {
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

function shouldFocusRendererWindow(command: RendererCommand): boolean {
  switch (command.type) {
    case "panel.focus":
    case "panel.open":
      return command.focus ?? true;
    case "panel.list":
    case "workspace.flushLayout":
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
  timeoutMs = 5000,
}: CreateRendererCommandServiceArgs): RendererCommandService {
  const pending = new Map<string, PendingRequest>();

  return {
    execute(command) {
      const requestId = createRequestId();
      const envelope: RendererCommandEnvelope = { command, requestId };
      if (
        !host.send(envelope, command.windowId, {
          focus: shouldFocusRendererWindow(command),
        })
      ) {
        return Promise.resolve(
          failure(
            requestId,
            "no renderer window available",
            command.windowId ? "not_found" : "platform_unavailable"
          )
        );
      }
      return new Promise((resolve) => {
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
        pending.set(requestId, { rejectTimer, resolve });
      });
    },
    resolve(result) {
      const request = pending.get(result.requestId);
      if (!request) {
        return;
      }
      clearTimeout(request.rejectTimer);
      pending.delete(result.requestId);
      request.resolve(result);
    },
  };
}
