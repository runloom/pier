/** agents 持久运行：单飞/inflight 分发（实现见 agents-runtime-ops）。 */
import type { LocalControlServerFrame } from "@shared/contracts/local-control/frames.ts";
import type { CapabilityAuthority } from "../../../services/capability/authority.ts";
import type { RuntimeControlService } from "../../../services/runtime-control/service.ts";
import { handleAgentsRuntimeOp } from "./agents-runtime-ops.ts";
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

function rebindRequestId(
  frame: LocalControlServerFrame,
  requestId: string
): LocalControlServerFrame {
  if (frame.type === "response") {
    return { ...frame, requestId };
  }
  return frame;
}

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
  capabilityAuthority?: CapabilityAuthority | undefined;
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
    capabilityAuthority,
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
        capabilityAuthority,
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
      capabilityAuthority,
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
    const flightKey = `${bootId}|${principalRef}|${op}|${effectKey}`;
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
