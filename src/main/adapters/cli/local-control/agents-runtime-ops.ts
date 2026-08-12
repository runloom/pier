/** agents runtime op 实现（从 agents-runtime 拆出控制行数）。 */
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
import { LOCAL_CONTROL_API_VERSION } from "@shared/contracts/local-control/errors.ts";
import type { LocalControlServerFrame } from "@shared/contracts/local-control/frames.ts";
import type { CapabilityAuthority } from "../../../services/capability/authority.ts";
import type { RuntimeControlService } from "../../../services/runtime-control/service.ts";
import {
  asPositiveInt,
  invalidParams,
  mapServiceResult,
  runWriteWithFence,
} from "./agents-runtime-fence.ts";
import {
  attachChildCapabilityRef,
  denyRuntimeAccess,
  releaseChildReservation,
  releaseRuntimeReservation,
  reserveChildForStart,
} from "./capability-hot-path.ts";
import { controlErrorResponse } from "./discovery.ts";
import type { EffectReceiptStore } from "./receipts.ts";

export async function handleAgentsRuntimeOp(args: {
  requestId: string;
  op: string;
  params: Record<string, unknown>;
  effectKey?: string | undefined;
  principalRef?: string | undefined;
  runtimeControl: RuntimeControlService | undefined;
  capabilityAuthority?: CapabilityAuthority | undefined;
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
  const capabilityAuthority = args.capabilityAuthority;
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
    {
      const denied = denyRuntimeAccess({
        authority: capabilityAuthority,
        principalRef,
        targetRuntimeId: parsed.data.runtimeId,
      });
      if (denied) {
        return controlErrorResponse(requestId, denied.code, denied.message);
      }
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
    // W6-S4：副作用前占额；receipt 重放在 session 层，不会再次 reserve
    const reserved = reserveChildForStart({
      authority: capabilityAuthority,
      principalRef,
    });
    if (reserved && "ok" in reserved && reserved.ok === false) {
      return controlErrorResponse(requestId, reserved.code, reserved.message);
    }
    const reservation =
      reserved && "childRef" in reserved ? reserved : undefined;
    return runWriteWithFence({
      requestId,
      ...writeCtx,
      sideEffect: async () => {
        let success = false;
        try {
          const result = await runtimeControl.start(parsed.data);
          if (!result.ok) {
            return result;
          }
          success = true;
          return {
            ok: true as const,
            data: attachChildCapabilityRef(result.data, reservation),
          };
        } finally {
          // throw 或 ok:false 都释放占额；成功则保留至 terminate
          if (!success) {
            releaseChildReservation({
              authority: capabilityAuthority,
              reservation,
            });
          }
        }
      },
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
    {
      const denied = denyRuntimeAccess({
        authority: capabilityAuthority,
        principalRef,
        targetRuntimeId: parsed.data.runtimeId,
      });
      if (denied) {
        return controlErrorResponse(requestId, denied.code, denied.message);
      }
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
    {
      const denied = denyRuntimeAccess({
        authority: capabilityAuthority,
        principalRef,
        targetRuntimeId: parsed.data.runtimeId,
      });
      if (denied) {
        return controlErrorResponse(requestId, denied.code, denied.message);
      }
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
    {
      const denied = denyRuntimeAccess({
        authority: capabilityAuthority,
        principalRef,
        targetRuntimeId: parsed.data.runtimeId,
      });
      if (denied) {
        return controlErrorResponse(requestId, denied.code, denied.message);
      }
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
    {
      const denied = denyRuntimeAccess({
        authority: capabilityAuthority,
        principalRef,
        targetRuntimeId: parsed.data.runtimeId,
      });
      if (denied) {
        return controlErrorResponse(requestId, denied.code, denied.message);
      }
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
      sideEffect: async () => {
        if (op === "agents.interrupt") {
          return runtimeControl.interrupt(parsed.data);
        }
        const result = await runtimeControl.terminate(parsed.data);
        if (result.ok) {
          releaseRuntimeReservation({
            authority: capabilityAuthority,
            runtimeId: parsed.data.runtimeId,
          });
        }
        return result;
      },
    });
  }

  return controlErrorResponse(
    requestId,
    "unsupported",
    `op not implemented: ${op}`
  );
}
