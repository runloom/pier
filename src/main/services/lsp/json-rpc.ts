import { z } from "zod";

export interface JsonRpcErrorShape {
  code: number;
  data?: unknown;
  message: string;
}

interface CancellableDelay {
  cancel(): void;
  promise: Promise<void>;
}

export const JSON_RPC_OBJECT_SCHEMA = z.record(z.string(), z.unknown());
const JSON_RPC_ERROR_SCHEMA = z
  .object({
    code: z.number().int().finite(),
    data: z.unknown().optional(),
    message: z.string(),
  })
  .loose();

function isJsonRpcId(value: unknown): value is number | string | null {
  return (
    value === null ||
    typeof value === "string" ||
    (typeof value === "number" && Number.isFinite(value))
  );
}

export function parseErrorShape(value: unknown): JsonRpcErrorShape | null {
  const parsed = JSON_RPC_ERROR_SCHEMA.safeParse(value);
  if (!parsed.success) {
    return null;
  }
  return parsed.data;
}

export function isValidJsonRpcMessage(
  value: unknown
): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const parsed = JSON_RPC_OBJECT_SCHEMA.safeParse(value);
  if (!(parsed.success && parsed.data.jsonrpc === "2.0")) {
    return false;
  }
  const message = parsed.data;
  const hasMethod = Object.hasOwn(message, "method");
  const hasResult = Object.hasOwn(message, "result");
  const hasError = Object.hasOwn(message, "error");
  if (hasMethod) {
    return (
      typeof message.method === "string" &&
      message.method.length > 0 &&
      !hasResult &&
      !hasError &&
      (!Object.hasOwn(message, "id") || isJsonRpcId(message.id))
    );
  }
  return (
    Object.hasOwn(message, "id") &&
    isJsonRpcId(message.id) &&
    hasResult !== hasError &&
    (!hasError || parseErrorShape(message.error) !== null)
  );
}

export function cancellableDelay(ms: number): CancellableDelay {
  const deferred = Promise.withResolvers<void>();
  const timer = setTimeout(deferred.resolve, ms);
  return {
    cancel() {
      clearTimeout(timer);
    },
    promise: deferred.promise,
  };
}
