import type {
  PluginRpcEventPayload,
  PluginRpcInvokeRequest,
  PluginRpcInvokeResult,
} from "@shared/contracts/plugin/rpc.ts";

/**
 * Plugin RPC bus (plan Task 5). handler map keyed by `${pluginId}:${method}`.
 * Renderer → main routes go through `rpc-ipc.ts`; main → renderer
 * events fan out via `broadcast` callback.
 *
 * Event payload constraint: MUST NOT include auth tokens, safeStorage
 * ciphertext, or other secret material — the broadcast reaches all Pier
 * windows before pluginId filtering (design §7.3).
 */

export type PluginRpcHandler = (payload: unknown) => Promise<unknown>;

export interface PluginRpcBus {
  clearPlugin(pluginId: string): void;
  emit(pluginId: string, event: string, payload: unknown): void;
  handle(pluginId: string, method: string, handler: PluginRpcHandler): void;
  invoke(request: PluginRpcInvokeRequest): Promise<PluginRpcInvokeResult>;
  /**
   * Main-process observer bypass for emit(): listeners receive the event
   * name plus a merged data envelope `{ ...payload, pluginId }` (non-object
   * payloads are wrapped as `{ payload, pluginId }`). Does not replace
   * broadcast(); returns a dispose function.
   */
  onEvent?(
    listener: (event: string, data: PluginRpcEventData) => void
  ): () => void;
}

export type PluginRpcEventData = { pluginId: string } & Record<string, unknown>;

export function createPluginRpcBus(options: {
  broadcast: (payload: PluginRpcEventPayload) => void;
}): PluginRpcBus {
  const handlers = new Map<string, Map<string, PluginRpcHandler>>();
  const eventListeners = new Set<
    (event: string, data: PluginRpcEventData) => void
  >();

  return {
    clearPlugin(pluginId): void {
      handlers.delete(pluginId);
    },
    emit(pluginId, event, payload): void {
      options.broadcast({ event, payload, pluginId });
      if (eventListeners.size === 0) {
        return;
      }
      const data: PluginRpcEventData =
        payload !== null &&
        typeof payload === "object" &&
        !Array.isArray(payload)
          ? { ...payload, pluginId }
          : { payload, pluginId };
      for (const listener of eventListeners) {
        listener(event, data);
      }
    },
    handle(pluginId, method, handler): void {
      const pluginHandlers = handlers.get(pluginId) ?? new Map();
      pluginHandlers.set(method, handler);
      handlers.set(pluginId, pluginHandlers);
    },
    onEvent(listener): () => void {
      eventListeners.add(listener);
      return () => {
        eventListeners.delete(listener);
      };
    },
    async invoke(request): Promise<PluginRpcInvokeResult> {
      const handler = handlers.get(request.pluginId)?.get(request.method);
      if (!handler) {
        return {
          error: {
            code: "not_found",
            message: `No RPC handler registered for ${request.pluginId}:${request.method}`,
          },
          ok: false,
        };
      }
      try {
        const data = await handler(request.payload);
        return { data, ok: true };
      } catch (err) {
        return {
          error: {
            code: "internal_error",
            message: err instanceof Error ? err.message : String(err),
          },
          ok: false,
        };
      }
    },
  };
}
