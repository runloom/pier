import type { LspDocumentGate } from "./document-gate.ts";
import { isValidJsonRpcMessage } from "./json-rpc.ts";
import type { LspSessionHost } from "./session-host.ts";
import type { RuntimeLogger } from "./session-runtime.ts";

export interface LspRealSessionInfo {
  realSessionId: string;
  rootPath: string;
  serverId: string;
  workspaceKey: string;
}

export interface EditorConsumer {
  deliver(jsonBody: string): void;
  lastActivityAt: number;
  notifyClosed(
    event: import("@shared/contracts/lsp.ts").LspSessionClosedEvent,
    treeTerminal: Promise<void>
  ): void;
  virtualSessionId: string;
  webContentsId: number;
  wireIdByOriginalKey: Map<string, string>;
}

export interface RealSessionRecord {
  consumersByVirtualId: Map<string, EditorConsumer>;
  gate: LspDocumentGate;
  info: LspRealSessionInfo;
  routesByWireId: Map<
    string,
    { originalId: number | string; virtualSessionId: string }
  >;
  serverRequestConsumerByIdKey: Map<string, string>;
  wireSeq: number;
}

export interface BrokerRouteHost {
  ensureInitialized(realSessionId: string): Promise<unknown>;
  host: LspSessionHost;
  logger?: RuntimeLogger;
}

export function lspIdKey(id: number | string): string {
  return `${typeof id}:${id}`;
}

export function isLspRequestId(value: unknown): value is number | string {
  return (
    typeof value === "string" ||
    (typeof value === "number" && Number.isFinite(value))
  );
}

export function parseEditorJsonRpc(
  jsonBody: string
): Record<string, unknown> | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonBody);
  } catch {
    return null;
  }
  if (!isValidJsonRpcMessage(parsed)) {
    return null;
  }
  return parsed;
}

export function primaryEditorConsumer(
  record: RealSessionRecord
): EditorConsumer | null {
  let primary: EditorConsumer | null = null;
  for (const consumer of record.consumersByVirtualId.values()) {
    if (!primary || consumer.lastActivityAt > primary.lastActivityAt) {
      primary = consumer;
    }
  }
  return primary;
}

export function handleEditorMethodMessage(
  ctx: BrokerRouteHost,
  record: RealSessionRecord,
  consumer: EditorConsumer,
  parsed: Record<string, unknown> & { method?: unknown },
  jsonBody: string
): boolean {
  const method = parsed.method as string;
  if (method === "initialize" && isLspRequestId(parsed.id)) {
    respondInitialize(ctx, record, consumer, parsed.id);
    return true;
  }
  if (method === "initialized") {
    return true;
  }
  if (method === "shutdown" && isLspRequestId(parsed.id)) {
    const responseId = parsed.id;
    queueMicrotask(() => {
      if (record.consumersByVirtualId.has(consumer.virtualSessionId)) {
        consumer.deliver(
          JSON.stringify({ id: responseId, jsonrpc: "2.0", result: null })
        );
      }
    });
    return true;
  }
  if (method === "exit") {
    return true;
  }
  if (method === "$/cancelRequest") {
    return forwardCancelRequest(ctx, record, consumer, parsed);
  }
  const gateOutcome = record.gate.handleEditorDocumentMessage(
    consumer.virtualSessionId,
    parsed,
    jsonBody
  );
  if (gateOutcome.handled) {
    return gateOutcome.sent;
  }
  if (isLspRequestId(parsed.id)) {
    return forwardRewrittenRequest(ctx, record, consumer, {
      ...parsed,
      id: parsed.id,
    });
  }
  return ctx.host.send(record.info.realSessionId, jsonBody);
}

export function routeBrokerInbound(
  ctx: BrokerRouteHost,
  record: RealSessionRecord,
  jsonBody: string,
  parsed: Record<string, unknown>
): void {
  const hasMethod = typeof parsed.method === "string";
  if (!hasMethod) {
    deliverRewrittenResponse(record, parsed);
    return;
  }
  if (isLspRequestId(parsed.id)) {
    routeServerRequest(ctx, record, jsonBody, parsed.id);
    return;
  }
  for (const consumer of record.consumersByVirtualId.values()) {
    consumer.deliver(jsonBody);
  }
}

function respondInitialize(
  ctx: BrokerRouteHost,
  record: RealSessionRecord,
  consumer: EditorConsumer,
  responseId: number | string
): void {
  ctx.ensureInitialized(record.info.realSessionId).then(
    (result) => {
      if (record.consumersByVirtualId.has(consumer.virtualSessionId)) {
        consumer.deliver(
          JSON.stringify({
            id: responseId,
            jsonrpc: "2.0",
            result: result ?? null,
          })
        );
      }
    },
    (error: unknown) => {
      ctx.logger?.warn("[lsp] gateway initialize failed", {
        error,
        realSessionId: record.info.realSessionId,
      });
      if (record.consumersByVirtualId.has(consumer.virtualSessionId)) {
        consumer.deliver(
          JSON.stringify({
            error: {
              code: -32_099,
              message: error instanceof Error ? error.message : String(error),
            },
            id: responseId,
            jsonrpc: "2.0",
          })
        );
      }
    }
  );
}

function forwardCancelRequest(
  ctx: BrokerRouteHost,
  record: RealSessionRecord,
  consumer: EditorConsumer,
  parsed: Record<string, unknown>
): boolean {
  const params =
    parsed.params && typeof parsed.params === "object"
      ? (parsed.params as Record<string, unknown>)
      : null;
  if (params && isLspRequestId(params.id)) {
    const wireId = consumer.wireIdByOriginalKey.get(lspIdKey(params.id));
    if (wireId) {
      return ctx.host.send(
        record.info.realSessionId,
        JSON.stringify({
          jsonrpc: "2.0",
          method: "$/cancelRequest",
          params: { id: wireId },
        })
      );
    }
  }
  return true;
}

function forwardRewrittenRequest(
  ctx: BrokerRouteHost,
  record: RealSessionRecord,
  consumer: EditorConsumer,
  parsed: Record<string, unknown> & { id: number | string }
): boolean {
  record.wireSeq += 1;
  const wireId = `${consumer.virtualSessionId}:${record.wireSeq}`;
  record.routesByWireId.set(wireId, {
    originalId: parsed.id,
    virtualSessionId: consumer.virtualSessionId,
  });
  consumer.wireIdByOriginalKey.set(lspIdKey(parsed.id), wireId);
  const sent = ctx.host.send(
    record.info.realSessionId,
    JSON.stringify({ ...parsed, id: wireId })
  );
  if (!sent) {
    record.routesByWireId.delete(wireId);
    consumer.wireIdByOriginalKey.delete(lspIdKey(parsed.id));
  }
  return sent;
}

function deliverRewrittenResponse(
  record: RealSessionRecord,
  parsed: Record<string, unknown>
): void {
  if (typeof parsed.id !== "string") {
    return;
  }
  const route = record.routesByWireId.get(parsed.id);
  if (!route) {
    return;
  }
  record.routesByWireId.delete(parsed.id);
  const consumer = record.consumersByVirtualId.get(route.virtualSessionId);
  if (!consumer) {
    return;
  }
  consumer.wireIdByOriginalKey.delete(lspIdKey(route.originalId));
  consumer.deliver(JSON.stringify({ ...parsed, id: route.originalId }));
}

function routeServerRequest(
  ctx: BrokerRouteHost,
  record: RealSessionRecord,
  jsonBody: string,
  requestId: number | string
): void {
  const primary = primaryEditorConsumer(record);
  if (!primary) {
    ctx.host.send(
      record.info.realSessionId,
      JSON.stringify({
        error: {
          code: -32_601,
          message: "Request not supported by Pier LSP gateway",
        },
        id: requestId,
        jsonrpc: "2.0",
      })
    );
    return;
  }
  record.serverRequestConsumerByIdKey.set(
    lspIdKey(requestId),
    primary.virtualSessionId
  );
  primary.deliver(jsonBody);
}
