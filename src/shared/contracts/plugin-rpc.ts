import { z } from "zod";

/**
 * Plugin RPC contracts. Renderer-scoped only — must NOT be routed
 * through `PierCommand` / CLI local-control (see design §7.0).
 *
 * - `invokeRequest`: renderer → main. `pluginId` is injected by the host
 *   runtime when creating the plugin context; plugin code never sets it
 *   itself (see design §7.3).
 * - `invokeResult`: transport envelope. Renderer runtime unwraps `{ ok: true }`
 *   to `data` for the plugin; `{ ok: false }` becomes a thrown structured error.
 * - `eventPayload`: main → renderer broadcast. Delivered to all Pier windows,
 *   filtered by pluginId at the renderer runtime before dispatching. Payload
 *   MUST NOT include auth tokens, safeStorage ciphertext, or other secret
 *   material (design §7.3).
 */

export const pluginRpcInvokeRequestSchema = z.object({
  method: z.string().min(1),
  payload: z.unknown().nullable(),
  pluginId: z.string().min(1),
});
export type PluginRpcInvokeRequest = z.infer<
  typeof pluginRpcInvokeRequestSchema
>;

export const pluginRpcErrorSchema = z.object({
  code: z.string().min(1),
  details: z.unknown().optional(),
  diagnosticId: z.string().min(1).optional(),
  message: z.string().min(1),
});
export type PluginRpcError = z.infer<typeof pluginRpcErrorSchema>;

export const pluginRpcInvokeResultSchema = z.discriminatedUnion("ok", [
  z.object({ data: z.unknown(), ok: z.literal(true) }),
  z.object({ error: pluginRpcErrorSchema, ok: z.literal(false) }),
]);
export type PluginRpcInvokeResult = z.infer<typeof pluginRpcInvokeResultSchema>;

export const pluginRpcEventPayloadSchema = z.object({
  event: z.string().min(1),
  payload: z.unknown(),
  pluginId: z.string().min(1),
});
export type PluginRpcEventPayload = z.infer<typeof pluginRpcEventPayloadSchema>;
