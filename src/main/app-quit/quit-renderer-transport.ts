import type {
  AppQuitConfirmationRequest,
  AppQuitDecisionPayload,
} from "@shared/contracts/app-quit.ts";
import { appQuitDecisionPayloadSchema } from "@shared/contracts/app-quit.ts";
import { PIER_BROADCAST } from "@shared/ipc-channels.ts";
import type { AppWindow } from "../windows/app-window.ts";
import { APP_QUIT_RENDERER_RESPONSE_TIMEOUT_MS } from "./quit-confirmation.ts";

interface PendingQuitDecision {
  resolve: (payload: AppQuitDecisionPayload) => void;
  timeout: NodeJS.Timeout;
}

export interface AppQuitRendererTransportDeps {
  getFallbackWindow: () => AppWindow | null;
  prepareWindow?: (window: AppWindow) => void;
  timeoutMs?: number;
}

export interface AppQuitRendererTransport {
  handleDecision(payload: unknown): boolean;
  sendRequest(
    parent: AppWindow | null,
    request: AppQuitConfirmationRequest
  ): Promise<AppQuitDecisionPayload>;
}

function cancelDecision(quitId: string): AppQuitDecisionPayload {
  return { decision: "cancel", quitId };
}

function isUsableWindow(window: AppWindow | null): window is AppWindow {
  return (
    window !== null &&
    !window.isDestroyed() &&
    !window.webContents.isDestroyed()
  );
}

export function createAppQuitRendererTransport(
  deps: AppQuitRendererTransportDeps
): AppQuitRendererTransport {
  const pending = new Map<string, PendingQuitDecision>();
  const timeoutMs = deps.timeoutMs ?? APP_QUIT_RENDERER_RESPONSE_TIMEOUT_MS;

  function resolvePending(payload: AppQuitDecisionPayload): boolean {
    const entry = pending.get(payload.quitId);
    if (!entry) {
      return false;
    }

    pending.delete(payload.quitId);
    clearTimeout(entry.timeout);
    entry.resolve(payload);
    return true;
  }

  function sendRequest(
    parent: AppWindow | null,
    request: AppQuitConfirmationRequest
  ): Promise<AppQuitDecisionPayload> {
    const target = isUsableWindow(parent) ? parent : deps.getFallbackWindow();
    if (!isUsableWindow(target)) {
      return Promise.resolve(cancelDecision(request.quitId));
    }

    const previous = pending.get(request.quitId);
    if (previous) {
      resolvePending(cancelDecision(request.quitId));
    }

    const deferred = Promise.withResolvers<AppQuitDecisionPayload>();
    const timeout = setTimeout(() => {
      resolvePending(cancelDecision(request.quitId));
    }, timeoutMs);
    pending.set(request.quitId, {
      resolve: deferred.resolve,
      timeout,
    });

    try {
      deps.prepareWindow?.(target);
      target.webContents.send(PIER_BROADCAST.APP_QUIT_REQUESTED, request);
    } catch {
      resolvePending(cancelDecision(request.quitId));
    }

    return deferred.promise;
  }

  function handleDecision(payload: unknown): boolean {
    const parsed = appQuitDecisionPayloadSchema.safeParse(payload);
    if (!parsed.success) {
      return false;
    }

    return resolvePending(parsed.data);
  }

  return { handleDecision, sendRequest };
}
