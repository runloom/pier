/**
 * v2 Ready 态 request 分发（从 session 拆出控制行数）。
 */
import type { LocalControlErrorCode } from "@shared/contracts/local-control/errors.ts";
import { LOCAL_CONTROL_API_VERSION } from "@shared/contracts/local-control/errors.ts";
import type { LocalControlServerFrame } from "@shared/contracts/local-control/frames.ts";
import type { CapabilityAuthority } from "../../../services/capability/authority.ts";
import type { ControlSnapshotService } from "../../../services/control-snapshot/service.ts";
import type { RuntimeControlService } from "../../../services/runtime-control/service.ts";
import type { AgentsDiscovery } from "./agents-discovery.ts";
import {
  dispatchAgentsRuntimeRequest,
  isAgentsRuntimeOp,
} from "./agents-runtime.ts";
import {
  isStrongEffectKey,
  LOCAL_CONTROL_WRITE_OPS,
  type LocalControlAuthorizeResult,
} from "./authorize.ts";
import type { ResolveOriginPanel } from "./capability-hot-path.ts";
import {
  handleControlHoldOp,
  handleControlSnapshotOp,
  handleControlWatchOp,
} from "./control-snapshot-ops.ts";
import {
  controlErrorResponse,
  handleDiscoveryOp,
  handleTraceOp,
} from "./discovery.ts";
import type { EffectReceiptStore } from "./receipts.ts";
import { digestRequestParams } from "./receipts.ts";

export function dispatchSessionRequest(args: {
  requestId: string;
  op: string;
  params: Record<string, unknown>;
  effectKey?: string | undefined;
  expectedBootId?: string | undefined;
  bootId: string;
  principalRef: string | undefined;
  discovery: AgentsDiscovery;
  receipts: EffectReceiptStore;
  runtimeControl: RuntimeControlService | undefined;
  capabilityAuthority: CapabilityAuthority | undefined;
  resolveOriginPanel: ResolveOriginPanel | undefined;
  snapshotService: ControlSnapshotService | undefined;
  inflight: Map<
    string,
    { ac: AbortController; kind: "hold" | "wait" | "watch" }
  >;
  disposed: () => boolean;
  nowMs: () => number;
  authorizeOp: (
    op: string,
    params: Record<string, unknown>,
    effectKey?: string
  ) => LocalControlAuthorizeResult;
  emit: (frame: LocalControlServerFrame) => void;
}): void {
  const {
    requestId,
    op,
    params,
    effectKey,
    expectedBootId,
    bootId,
    principalRef,
    discovery,
    receipts,
    runtimeControl,
    capabilityAuthority,
    resolveOriginPanel,
    snapshotService,
    inflight,
    disposed,
    nowMs,
    authorizeOp,
    emit,
  } = args;

  if (op === "agents.invoke") {
    emit(
      controlErrorResponse(
        requestId,
        "unsupported",
        "agents.invoke is not a Pier product path; use the agent native CLI (e.g. codex exec) for one-shot"
      )
    );
    return;
  }
  if (
    typeof expectedBootId === "string" &&
    expectedBootId.length > 0 &&
    expectedBootId !== bootId
  ) {
    emit(
      controlErrorResponse(
        requestId,
        "boot_changed",
        "expectedBootId does not match current control-plane boot"
      )
    );
    return;
  }
  if (
    LOCAL_CONTROL_WRITE_OPS.has(op) &&
    !(effectKey && isStrongEffectKey(effectKey))
  ) {
    emit(
      controlErrorResponse(
        requestId,
        "invalid_command",
        "write op requires effectKey (>=128-bit opaque, base64url/hex, len>=22)"
      )
    );
    return;
  }
  // 授权在 receipt 重放之前：鉴权失败则不得重放旧成功 receipt
  const auth = authorizeOp(op, params, effectKey);
  if (!auth.ok) {
    emit(controlErrorResponse(requestId, auth.code, auth.message));
    return;
  }
  if (LOCAL_CONTROL_WRITE_OPS.has(op) && effectKey && principalRef) {
    let digest: string;
    try {
      digest = digestRequestParams(params);
    } catch (error) {
      emit(
        controlErrorResponse(
          requestId,
          "invalid_command",
          error instanceof Error ? error.message : "invalid params digest"
        )
      );
      return;
    }
    const existing = receipts.lookup({ principalRef, op, effectKey });
    if (existing) {
      if (existing.digest !== digest) {
        emit(
          controlErrorResponse(
            requestId,
            "idempotency_conflict",
            "effectKey reused with different params"
          )
        );
        return;
      }
      // 重放前再鉴权一次
      const reauth = authorizeOp(op, params, effectKey);
      if (!reauth.ok) {
        emit(controlErrorResponse(requestId, reauth.code, reauth.message));
        return;
      }
      if (existing.ok) {
        emit({
          apiVersion: LOCAL_CONTROL_API_VERSION,
          type: "response",
          requestId,
          ok: true,
          data: existing.responseData,
          meta: { effectRevision: existing.effectRevision },
        });
        return;
      }
      emit(
        controlErrorResponse(
          requestId,
          (existing.error?.code as LocalControlErrorCode) ?? "internal_error",
          existing.error?.message ?? "replayed failed effect"
        )
      );
      return;
    }
  }
  if (op === "agents.self") {
    emit(
      controlErrorResponse(
        requestId,
        "unsupported",
        "agents.self is not a product path"
      )
    );
    return;
  }
  if (op === "agents.catalog" || op === "agents.list" || op === "agents.get") {
    emit(handleDiscoveryOp({ requestId, op, params, discovery }));
    return;
  }
  if (isAgentsRuntimeOp(op)) {
    dispatchAgentsRuntimeRequest({
      requestId,
      op,
      params,
      effectKey,
      principalRef,
      bootId,
      runtimeControl,
      capabilityAuthority,
      resolveOriginPanel,
      receipts,
      inflight,
      disposed,
      emit,
    });
    return;
  }
  if (op === "control.trace") {
    emit(
      handleTraceOp({
        requestId,
        params,
        effectKey: effectKey ?? "",
        principalRef,
        receipts,
        nowMs: nowMs(),
      })
    );
    return;
  }
  if (op === "control.hold") {
    handleControlHoldOp({
      requestId,
      params,
      inflight,
      disposed,
      emit,
    });
    return;
  }
  if (op === "control.snapshot") {
    const fail = (err: unknown) =>
      emit(
        controlErrorResponse(
          requestId,
          "internal_error",
          err instanceof Error ? err.message : "control.snapshot failed"
        )
      );
    handleControlSnapshotOp({
      requestId,
      params,
      snapshotService,
    })
      .then(emit)
      .catch(fail);
    return;
  }
  if (op === "control.watch") {
    const fail = (err: unknown) => {
      inflight.delete(requestId);
      emit(
        controlErrorResponse(
          requestId,
          "internal_error",
          err instanceof Error ? err.message : "control.watch failed"
        )
      );
    };
    handleControlWatchOp({
      requestId,
      params,
      bootId,
      snapshotService,
      inflight,
      disposed,
      emit,
    }).catch(fail);
    return;
  }
  emit(
    controlErrorResponse(requestId, "unsupported", `op not implemented: ${op}`)
  );
}
