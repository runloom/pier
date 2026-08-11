/** agents 持久运行：单飞/inflight + RuntimeControlService（名单见 features）。 */
import {
  AGENTS_SCREEN_DEFAULT_MAX_BYTES,
  AGENTS_SCREEN_DEFAULT_MAX_LINES,
  agentsRuntimeTargetParamsSchema,
  agentsScreenParamsSchema,
  agentsStartParamsSchema,
  agentsTurnParamsSchema,
  agentsWaitParamsSchema,
  agentsWatchParamsSchema,
} from "@shared/contracts/local-control/agents-runtime.ts";
import type { LocalControlErrorCode } from "@shared/contracts/local-control/errors.ts";
import { LOCAL_CONTROL_API_VERSION } from "@shared/contracts/local-control/errors.ts";
import type { LocalControlServerFrame } from "@shared/contracts/local-control/frames.ts";
import type { RuntimeControlService } from "../../../services/runtime-control/service.ts";
import { controlErrorResponse } from "./discovery.ts";
import {
  AGENTS_RUNTIME_OPS,
  AGENTS_RUNTIME_WRITE_OPS,
  type AgentsRuntimeOp,
} from "./features.ts";
import type { EffectReceiptStore } from "./receipts.ts";
import { digestRequestParams } from "./receipts.ts";

export {
  AGENTS_RUNTIME_OPS,
  AGENTS_RUNTIME_WRITE_OPS,
  type AgentsRuntimeOp,
} from "./features.ts";

const RUNTIME_OP_SET = new Set<string>(AGENTS_RUNTIME_OPS);
const WRITE_OP_SET = new Set<string>(AGENTS_RUNTIME_WRITE_OPS);

export function isAgentsRuntimeOp(op: string): op is AgentsRuntimeOp {
  return RUNTIME_OP_SET.has(op);
}

interface InflightEntry {
  ac: AbortController;
  kind: "hold" | "wait" | "watch";
}

interface WriteFlight {
  digest: string;
  promise: Promise<LocalControlServerFrame>;
}
const writeFlights = new Map<string, WriteFlight>();

function asPositiveInt(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? Math.floor(value)
    : fallback;
}

function okResponse(
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

function invalidParams(
  requestId: string,
  message: string
): LocalControlServerFrame {
  return controlErrorResponse(requestId, "invalid_command", message);
}

type ServiceResult =
  | { ok: true; data: unknown }
  | {
      ok: false;
      code: LocalControlErrorCode;
      message: string;
    };

function mapServiceResult(
  requestId: string,
  result: ServiceResult,
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
 * digest 使用传入 params（调用方应对 turn 做规范化后再传入）。
 */
async function runWriteWithFence(args: {
  requestId: string;
  sideEffect: () => Promise<ServiceResult>;
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
  // F 在副作用前单调分配（设计 §7.3）
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

async function handleAgentsRuntimeOp(args: {
  requestId: string;
  op: string;
  params: Record<string, unknown>;
  effectKey?: string | undefined;
  principalRef?: string | undefined;
  runtimeControl: RuntimeControlService | undefined;
  receipts: EffectReceiptStore;
  signal?: AbortSignal | undefined;
  bootId?: string | undefined;
  emitEvent?: ((frame: LocalControlServerFrame) => void) | undefined;
}): Promise<LocalControlServerFrame> {
  const { requestId, op, params, effectKey, principalRef, receipts } = args;
  if (!args.runtimeControl) {
    return controlErrorResponse(
      requestId,
      "unsupported",
      "agents runtime control is not configured"
    );
  }
  const runtimeControl = args.runtimeControl;
  const writeCtx = {
    receipts,
    principalRef,
    op,
    effectKey,
    params,
  };

  if (op === "agents.watch") {
    const parsed = agentsWatchParamsSchema.safeParse(params);
    if (!parsed.success) {
      return invalidParams(
        requestId,
        parsed.error.issues[0]?.message ?? "invalid agents.watch params"
      );
    }
    let revision = 0;
    const result = await runtimeControl.watch({
      ...parsed.data,
      signal: args.signal,
      onSample: (sample) => {
        if (!(args.emitEvent && args.bootId)) {
          return;
        }
        revision += 1;
        args.emitEvent({
          apiVersion: LOCAL_CONTROL_API_VERSION,
          type: "event",
          subscriptionId: requestId,
          bootId: args.bootId,
          revision,
          cursorScope: "agents.runtime",
          mode: "live",
          payload: {
            kind: "agent.state",
            fact: sample.fact,
            ts: sample.ts,
            runtime: sample.runtime,
          },
        });
      },
    });
    return mapServiceResult(requestId, result);
  }

  if (op === "agents.start") {
    const parsed = agentsStartParamsSchema.safeParse(params);
    if (!parsed.success) {
      return invalidParams(
        requestId,
        parsed.error.issues[0]?.message ?? "invalid agents.start params"
      );
    }
    return runWriteWithFence({
      requestId,
      ...writeCtx,
      sideEffect: () => runtimeControl.start(parsed.data),
    });
  }

  if (op === "agents.turn") {
    const parsed = agentsTurnParamsSchema.safeParse(params);
    if (!parsed.success) {
      return invalidParams(
        requestId,
        parsed.error.issues[0]?.message ?? "invalid agents.turn params"
      );
    }
    const text = /[\r\n]$/u.test(parsed.data.text)
      ? parsed.data.text
      : `${parsed.data.text}\n`;
    // digest 与副作用使用同一规范化 text，保证 --operation-id 幂等
    const effectParams = { ...params, text };
    return runWriteWithFence({
      requestId,
      ...writeCtx,
      params: effectParams,
      sideEffect: () => runtimeControl.turn({ ...parsed.data, text }),
    });
  }

  if (op === "agents.screen") {
    const parsed = agentsScreenParamsSchema.safeParse({
      ...params,
      maxLines: asPositiveInt(params.maxLines, AGENTS_SCREEN_DEFAULT_MAX_LINES),
      maxBytes: asPositiveInt(params.maxBytes, AGENTS_SCREEN_DEFAULT_MAX_BYTES),
    });
    if (!parsed.success) {
      return invalidParams(
        requestId,
        parsed.error.issues[0]?.message ?? "invalid agents.screen params"
      );
    }
    return mapServiceResult(
      requestId,
      await runtimeControl.screen(parsed.data)
    );
  }

  if (op === "agents.wait") {
    const parsed = agentsWaitParamsSchema.safeParse(params);
    if (!parsed.success) {
      return invalidParams(
        requestId,
        parsed.error.issues[0]?.message ?? "invalid agents.wait params"
      );
    }
    return mapServiceResult(
      requestId,
      await runtimeControl.wait({ ...parsed.data, signal: args.signal })
    );
  }

  if (
    op === "agents.focus" ||
    op === "agents.interrupt" ||
    op === "agents.terminate"
  ) {
    const parsed = agentsRuntimeTargetParamsSchema.safeParse(params);
    if (!parsed.success) {
      return invalidParams(
        requestId,
        parsed.error.issues[0]?.message ?? `invalid ${op} params`
      );
    }
    if (op === "agents.focus") {
      return runWriteWithFence({
        requestId,
        ...writeCtx,
        skipReceipt: true,
        sideEffect: () => runtimeControl.focus(parsed.data),
      });
    }
    return runWriteWithFence({
      requestId,
      ...writeCtx,
      sideEffect: () =>
        op === "agents.interrupt"
          ? runtimeControl.interrupt(parsed.data)
          : runtimeControl.terminate(parsed.data),
    });
  }

  return controlErrorResponse(
    requestId,
    "unsupported",
    `op not implemented: ${op}`
  );
}

function rebindRequestId(
  frame: LocalControlServerFrame,
  requestId: string
): LocalControlServerFrame {
  if (frame.type === "response") {
    return { ...frame, requestId };
  }
  return frame;
}

/** 避免 floating void 运算符；仍 fire-and-forget 分发。 */
function settleFrame(
  promise: Promise<LocalControlServerFrame>,
  onFrame: (frame: LocalControlServerFrame) => void,
  onError: (error: unknown) => void
): void {
  promise.then(onFrame).catch(onError);
}

export function dispatchAgentsRuntimeRequest(args: {
  requestId: string;
  op: string;
  params: Record<string, unknown>;
  effectKey?: string | undefined;
  principalRef?: string | undefined;
  bootId: string;
  runtimeControl: RuntimeControlService | undefined;
  receipts: EffectReceiptStore;
  inflight: Map<string, InflightEntry>;
  disposed: () => boolean;
  emit: (frame: LocalControlServerFrame) => void;
}): void {
  const {
    requestId,
    op,
    params,
    effectKey,
    principalRef,
    bootId,
    runtimeControl,
    receipts,
    inflight,
    disposed,
    emit,
  } = args;

  const emitSafe = (frame: LocalControlServerFrame) => {
    if (!disposed()) {
      emit(frame);
    }
  };

  if (op === "agents.wait" || op === "agents.watch") {
    if (inflight.has(requestId)) {
      emitSafe(
        controlErrorResponse(
          requestId,
          "effect_in_progress",
          "request already in flight"
        )
      );
      return;
    }
    const ac = new AbortController();
    inflight.set(requestId, {
      ac,
      kind: op === "agents.watch" ? "watch" : "wait",
    });
    settleFrame(
      handleAgentsRuntimeOp({
        requestId,
        op,
        params,
        effectKey,
        principalRef,
        runtimeControl,
        receipts,
        signal: ac.signal,
        bootId,
        emitEvent: emit,
      }).finally(() => {
        inflight.delete(requestId);
      }),
      emitSafe,
      (error: unknown) => {
        emitSafe(
          controlErrorResponse(
            requestId,
            "internal_error",
            error instanceof Error ? error.message : String(error)
          )
        );
      }
    );
    return;
  }

  const run = () =>
    handleAgentsRuntimeOp({
      requestId,
      op,
      params,
      effectKey,
      principalRef,
      runtimeControl,
      receipts,
      bootId,
    });

  if (WRITE_OP_SET.has(op) && effectKey && principalRef) {
    let digest: string;
    try {
      digest = digestRequestParams(params);
    } catch (error) {
      emitSafe(
        controlErrorResponse(
          requestId,
          "invalid_command",
          error instanceof Error ? error.message : "invalid params digest"
        )
      );
      return;
    }
    const flightKey = `${bootId}\0${principalRef}\0${op}\0${effectKey}`;
    const existing = writeFlights.get(flightKey);
    if (existing) {
      if (existing.digest !== digest) {
        emitSafe(
          controlErrorResponse(
            requestId,
            "idempotency_conflict",
            "effectKey reused with different params while in flight"
          )
        );
        return;
      }
      settleFrame(
        existing.promise,
        (frame) => {
          emitSafe(rebindRequestId(frame, requestId));
        },
        (error: unknown) => {
          emitSafe(
            controlErrorResponse(
              requestId,
              "internal_error",
              error instanceof Error ? error.message : String(error)
            )
          );
        }
      );
      return;
    }
    const flight = run().finally(() => {
      writeFlights.delete(flightKey);
    });
    writeFlights.set(flightKey, { digest, promise: flight });
    settleFrame(flight, emitSafe, (error: unknown) => {
      emitSafe(
        controlErrorResponse(
          requestId,
          "internal_error",
          error instanceof Error ? error.message : String(error)
        )
      );
    });
    return;
  }

  settleFrame(run(), emitSafe, (error: unknown) => {
    emitSafe(
      controlErrorResponse(
        requestId,
        "internal_error",
        error instanceof Error ? error.message : String(error)
      )
    );
  });
}
