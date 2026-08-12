/**
 * agents 写 op fence + 结果映射（从 agents-runtime 拆出控制行数）。
 */
import type { LocalControlErrorCode } from "@shared/contracts/local-control/errors.ts";
import { LOCAL_CONTROL_API_VERSION } from "@shared/contracts/local-control/errors.ts";
import type { LocalControlServerFrame } from "@shared/contracts/local-control/frames.ts";
import { controlErrorResponse } from "./discovery.ts";
import type { EffectReceiptStore } from "./receipts.ts";
import { digestRequestParams } from "./receipts.ts";

export function asPositiveInt(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? Math.floor(value)
    : fallback;
}

export function okResponse(
  requestId: string,
  data: unknown,
  effectRevision?: number
): LocalControlServerFrame {
  return {
    apiVersion: LOCAL_CONTROL_API_VERSION,
    type: "response",
    requestId,
    ok: true,
    data,
    ...(effectRevision === undefined ? {} : { meta: { effectRevision } }),
  };
}

export function invalidParams(
  requestId: string,
  message: string
): LocalControlServerFrame {
  return controlErrorResponse(requestId, "invalid_command", message);
}

export type AgentsServiceResult =
  | { ok: true; data: unknown }
  | {
      ok: false;
      code: LocalControlErrorCode;
      message: string;
    };

export function mapServiceResult(
  requestId: string,
  result: AgentsServiceResult,
  receiptMeta?: {
    effectRevision: number | undefined;
  }
): LocalControlServerFrame {
  if (!result.ok) {
    return controlErrorResponse(requestId, result.code, result.message);
  }
  return okResponse(requestId, result.data, receiptMeta?.effectRevision);
}

/**
 * 写 op fence：先分配 effectRevision=F，再执行副作用，最后以 F 提交终态。
 */
export async function runWriteWithFence(args: {
  requestId: string;
  sideEffect: () => Promise<AgentsServiceResult>;
  receipts: EffectReceiptStore;
  principalRef: string | undefined;
  op: string;
  effectKey: string | undefined;
  params: Record<string, unknown>;
  skipReceipt?: boolean;
}): Promise<LocalControlServerFrame> {
  const {
    requestId,
    sideEffect,
    receipts,
    principalRef,
    op,
    effectKey,
    params,
    skipReceipt,
  } = args;
  if (skipReceipt || !(effectKey && principalRef)) {
    return mapServiceResult(requestId, await sideEffect());
  }
  const effectRevision = receipts.nextRevision();
  const digest = digestRequestParams(params);
  const result = await sideEffect();
  receipts.commit({
    principalRef,
    op,
    effectKey,
    digest,
    effectRevision,
    ok: result.ok,
    ...(result.ok
      ? { responseData: result.data }
      : {
          error: {
            code: result.code,
            message: result.message,
          },
        }),
  });
  return mapServiceResult(requestId, result, { effectRevision });
}
