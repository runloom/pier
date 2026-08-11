import {
  LOCAL_CONTROL_API_VERSION,
  type LocalControlErrorCode,
} from "@shared/contracts/local-control/errors.ts";
import {
  type LocalControlClientHello,
  type LocalControlServerFrame,
  localControlClientFrameSchema,
} from "@shared/contracts/local-control/frames.ts";
import type { AgentCallerCredentialStore } from "../../../services/agent-caller/credential-store.ts";
import type { ControlSnapshotService } from "../../../services/control-snapshot/service.ts";
import type { RuntimeControlService } from "../../../services/runtime-control/service.ts";
import {
  type AgentsDiscovery,
  createStaticAgentsDiscovery,
} from "./agents-discovery.ts";
import {
  dispatchAgentsRuntimeRequest,
  isAgentsRuntimeOp,
} from "./agents-runtime.ts";
import {
  createDefaultLocalControlAuthorizer,
  isStrongEffectKey,
  LOCAL_CONTROL_WRITE_OPS,
  type LocalControlAuthorizer,
} from "./authorize.ts";
import {
  handleControlHoldOp,
  handleControlSnapshotOp,
  handleControlWatchOp,
} from "./control-snapshot-ops.ts";
import {
  controlErrorResponse,
  handleAgentsSelfOp,
  handleDiscoveryOp,
  handleTraceOp,
} from "./discovery.ts";
import { buildLocalControlFeatures, serverErrorFrame } from "./features.ts";
import { resolveHelloPrincipal } from "./hello-auth.ts";
import {
  createEffectReceiptStore,
  digestRequestParams,
  type EffectReceiptStore,
} from "./receipts.ts";
import {
  handleControlSubscribe,
  type SubscriptionRecord,
} from "./subscribe.ts";

type InflightMap = Map<
  string,
  { ac: AbortController; kind: "hold" | "wait" | "watch" }
>;

export interface LocalControlSession {
  readonly bootId: string;
  dispose(): void;
  handleLine(line: string): void;
  readonly principalKind: LocalControlClientHello["clientKind"];
  readonly principalRef?: string | undefined;
}

export interface CreateLocalControlSessionArgs {
  authorizer?: LocalControlAuthorizer | undefined;
  bootId: string;
  credentialStore?: AgentCallerCredentialStore | undefined;
  discovery?: AgentsDiscovery | undefined;
  emit: (frame: LocalControlServerFrame) => void;
  features?: readonly string[] | undefined;
  nowMs?: (() => number) | undefined;
  receipts?: EffectReceiptStore | undefined;
  /** W3 持久运行控制；缺省则 runtime op 返回 unsupported。 */
  runtimeControl?: RuntimeControlService | undefined;
  /** W4 顶层 snapshot/watch 聚合器。 */
  snapshotService?: ControlSnapshotService | undefined;
}

export type CreateSessionFromHelloResult =
  | {
      ok: true;
      session: LocalControlSession;
      helloFrame: LocalControlServerFrame;
    }
  | { ok: false; errorFrame: LocalControlServerFrame };

export function createLocalControlSessionFromHello(
  hello: LocalControlClientHello,
  args: CreateLocalControlSessionArgs
): CreateSessionFromHelloResult {
  const nowMs = args.nowMs ?? (() => Date.now());
  const store = args.credentialStore;
  const discovery = args.discovery ?? createStaticAgentsDiscovery();
  const authorizer = args.authorizer ?? createDefaultLocalControlAuthorizer();
  const receipts = args.receipts ?? createEffectReceiptStore();
  const { emit } = args;

  let disposed = false;
  const inflight: InflightMap = new Map();
  const subscriptions = new Map<string, SubscriptionRecord>();

  const principal = resolveHelloPrincipal({
    hello,
    bootId: args.bootId,
    store,
    nowMs: nowMs(),
  });
  if (!principal.ok) {
    return { ok: false, errorFrame: principal.errorFrame };
  }
  const { material, principalRef } = principal;

  const helloFrame: LocalControlServerFrame = {
    apiVersion: LOCAL_CONTROL_API_VERSION,
    type: "server.hello",
    requestId: hello.requestId,
    bootId: args.bootId,
    serverTimeMs: nowMs(),
    features: buildLocalControlFeatures(
      args.features ?? [],
      material,
      hello.clientKind
    ),
    ...(principalRef ? { principalRef } : {}),
  };

  const emitSafe = (frame: LocalControlServerFrame) => {
    if (!disposed) {
      emit(frame);
    }
  };

  const authorizeOp = (
    op: string,
    params: Record<string, unknown>,
    effectKey?: string
  ) =>
    authorizer.authorize({
      principalKind: hello.clientKind,
      principalRef,
      material,
      op,
      params,
      effectKey,
    });

  const session: LocalControlSession = {
    bootId: args.bootId,
    principalKind: hello.clientKind,
    principalRef,
    dispose() {
      disposed = true;
      for (const entry of inflight.values()) {
        entry.ac.abort();
      }
      inflight.clear();
      subscriptions.clear();
    },
    handleLine(line: string) {
      if (disposed || line.length === 0) {
        return;
      }
      let raw: unknown;
      try {
        raw = JSON.parse(line) as unknown;
      } catch {
        emitSafe(serverErrorFrame("invalid_command", "invalid JSON frame"));
        return;
      }
      const parsed = localControlClientFrameSchema.safeParse(raw);
      if (!parsed.success) {
        const requestId =
          typeof raw === "object" &&
          raw !== null &&
          "requestId" in raw &&
          typeof (raw as { requestId: unknown }).requestId === "string"
            ? (raw as { requestId: string }).requestId
            : "unknown";
        emitSafe(
          controlErrorResponse(
            requestId,
            "invalid_command",
            parsed.error.issues[0]?.message ?? "invalid v2 frame"
          )
        );
        return;
      }
      const frame = parsed.data;
      if (frame.type === "client.hello") {
        emitSafe(
          controlErrorResponse(
            frame.requestId,
            "protocol_unsupported",
            "client.hello only allowed as first frame"
          )
        );
        return;
      }
      if (frame.type === "client.auth-proof") {
        emitSafe(
          controlErrorResponse(
            frame.requestId,
            "unsupported",
            "auth-proof is not implemented yet"
          )
        );
        return;
      }
      if (frame.type === "cancel") {
        const entry = inflight.get(frame.requestId);
        if (!entry) {
          emitSafe(
            controlErrorResponse(
              frame.requestId,
              "not_found",
              "no in-flight request to cancel"
            )
          );
          return;
        }
        if (entry.kind === "wait" || entry.kind === "watch") {
          // 终态由 wait/watch 响应帧返回
          entry.ac.abort();
          return;
        }
        entry.ac.abort();
        inflight.delete(frame.requestId);
        emitSafe({
          apiVersion: LOCAL_CONTROL_API_VERSION,
          type: "response",
          requestId: frame.requestId,
          ok: true,
          data: { cancelled: true },
        });
        return;
      }
      if (frame.type === "subscribe") {
        handleControlSubscribe({
          requestId: frame.requestId,
          stream: frame.stream,
          ...(frame.after === undefined ? {} : { after: frame.after }),
          bootId: args.bootId,
          discovery,
          subscriptions,
          authorizeList: () => authorizeOp("agents.list", {}),
          emit: emitSafe,
        });
        return;
      }
      if (frame.type === "unsubscribe") {
        if (!subscriptions.has(frame.subscriptionId)) {
          emitSafe(
            controlErrorResponse(
              frame.requestId,
              "not_found",
              "unknown subscriptionId"
            )
          );
          return;
        }
        subscriptions.delete(frame.subscriptionId);
        emitSafe({
          apiVersion: LOCAL_CONTROL_API_VERSION,
          type: "response",
          requestId: frame.requestId,
          ok: true,
          data: { unsubscribed: true, subscriptionId: frame.subscriptionId },
        });
        return;
      }
      handleRequest(
        frame.requestId,
        frame.op,
        frame.params,
        frame.effectKey,
        frame.expectedBootId
      );
    },
  };

  function handleRequest(
    requestId: string,
    op: string,
    params: Record<string, unknown>,
    effectKey?: string,
    expectedBootId?: string
  ) {
    // 产品 non-goal：一次性走原生 agent CLI，不经 Pier 封装。
    if (op === "agents.invoke") {
      emitSafe(
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
      expectedBootId !== args.bootId
    ) {
      emitSafe(
        controlErrorResponse(
          requestId,
          "boot_changed",
          "expectedBootId does not match current control-plane boot"
        )
      );
      return;
    }
    // 协议边界：写 op effectKey 强度在 session 无条件执行，不可被 authorizer 旁路
    if (
      LOCAL_CONTROL_WRITE_OPS.has(op) &&
      !(effectKey && isStrongEffectKey(effectKey))
    ) {
      emitSafe(
        controlErrorResponse(
          requestId,
          "invalid_command",
          "write op requires effectKey (>=128-bit opaque, base64url/hex, len>=22)"
        )
      );
      return;
    }
    const auth = authorizeOp(op, params, effectKey);
    if (!auth.ok) {
      emitSafe(controlErrorResponse(requestId, auth.code, auth.message));
      return;
    }
    if (LOCAL_CONTROL_WRITE_OPS.has(op) && effectKey && principalRef) {
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
      const existing = receipts.lookup({ principalRef, op, effectKey });
      if (existing) {
        if (existing.digest !== digest) {
          emitSafe(
            controlErrorResponse(
              requestId,
              "idempotency_conflict",
              "effectKey reused with different params"
            )
          );
          return;
        }
        if (existing.ok) {
          emitSafe({
            apiVersion: LOCAL_CONTROL_API_VERSION,
            type: "response",
            requestId,
            ok: true,
            data: existing.responseData,
            meta: { effectRevision: existing.effectRevision },
          });
          return;
        }
        emitSafe(
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
      emitSafe(
        handleAgentsSelfOp({
          requestId,
          material,
          principalRef,
          nowMs: nowMs(),
        })
      );
      return;
    }
    if (
      op === "agents.catalog" ||
      op === "agents.list" ||
      op === "agents.get"
    ) {
      emitSafe(handleDiscoveryOp({ requestId, op, params, discovery }));
      return;
    }
    if (isAgentsRuntimeOp(op)) {
      dispatchAgentsRuntimeRequest({
        requestId,
        op,
        params,
        effectKey,
        principalRef,
        bootId: args.bootId,
        runtimeControl: args.runtimeControl,
        receipts,
        inflight,
        disposed: () => disposed,
        emit: emitSafe,
      });
      return;
    }
    if (op === "control.trace") {
      emitSafe(
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
        disposed: () => disposed,
        emit: emitSafe,
      });
      return;
    }
    if (op === "control.snapshot") {
      const fail = (err: unknown) =>
        emitSafe(
          controlErrorResponse(
            requestId,
            "internal_error",
            err instanceof Error ? err.message : "control.snapshot failed"
          )
        );
      // fire-and-forget；用 then/catch 避免 void 运算符
      handleControlSnapshotOp({
        requestId,
        params,
        snapshotService: args.snapshotService,
      })
        .then(emitSafe)
        .catch(fail);
      return;
    }
    if (op === "control.watch") {
      const fail = (err: unknown) => {
        inflight.delete(requestId);
        emitSafe(
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
        bootId: args.bootId,
        snapshotService: args.snapshotService,
        inflight,
        disposed: () => disposed,
        emit: emitSafe,
      }).catch(fail);
      return;
    }
    emitSafe(
      controlErrorResponse(
        requestId,
        "unsupported",
        `op not implemented: ${op}`
      )
    );
  }

  return { ok: true, session, helloFrame };
}
