import type {
  PluginRpcEventPayload,
  PluginRpcInvokeRequest,
  PluginRpcInvokeResult,
} from "@shared/contracts/plugin-rpc.ts";

/**
 * Plugin RPC bus (plan Task 5). handler map keyed by `${pluginId}:${method}`.
 * Renderer → main routes go through `plugin-rpc-ipc.ts`; main → renderer
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
}

export function createPluginRpcBus(options: {
  broadcast: (payload: PluginRpcEventPayload) => void;
}): PluginRpcBus {
  const handlers = new Map<string, Map<string, PluginRpcHandler>>();

  return {
    clearPlugin(pluginId): void {
      handlers.delete(pluginId);
    },
    emit(pluginId, event, payload): void {
      options.broadcast({ event, payload, pluginId });
    },
    handle(pluginId, method, handler): void {
      const pluginHandlers = handlers.get(pluginId) ?? new Map();
      pluginHandlers.set(method, handler);
      handlers.set(pluginId, pluginHandlers);
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
