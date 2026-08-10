/**
 * pier.control/v2 会话 — 架构闭环：authorize · receipt · subscribe · hold/cancel · agents
 */
import { randomUUID } from "node:crypto";
import type { AgentCallerCredentialMaterial } from "@shared/contracts/local-control/agent-credential.ts";
import { LOCAL_CONTROL_V2_API_VERSION } from "@shared/contracts/local-control/v2-errors.ts";
import {
  type LocalControlV2ClientHello,
  type LocalControlV2ServerFrame,
  localControlV2ClientFrameSchema,
} from "@shared/contracts/local-control/v2-frames.ts";
import type { AgentCallerCredentialStore } from "../../services/agent-caller/credential-store.ts";
import {
  resolveAgentBinding,
  resolveAgentCredential,
} from "../../services/agent-caller/credential-store.ts";
import {
  type AgentsDiscovery,
  createStaticAgentsDiscovery,
} from "./agents-discovery.ts";
import {
  createDefaultLocalControlAuthorizer,
  LOCAL_CONTROL_WRITE_OPS,
  type LocalControlAuthorizer,
} from "./local-control-authorize.ts";
import {
  createEffectReceiptStore,
  digestRequestParams,
  type EffectReceiptStore,
} from "./local-control-receipts.ts";
import {
  buildLocalControlV2Features,
  serverErrorFrame,
} from "./local-control-v2-features.ts";
import {
  handleAgentsSelfOp,
  handleDiscoveryOp,
  handleTraceOp,
  v2ErrorResponse,
} from "./local-control-v2-ops.ts";

export {
  LOCAL_CONTROL_V2_FEATURE_AGENTS_CATALOG,
  LOCAL_CONTROL_V2_FEATURE_AGENTS_GET,
  LOCAL_CONTROL_V2_FEATURE_AGENTS_LIST,
  LOCAL_CONTROL_V2_FEATURE_AGENTS_SELF,
  LOCAL_CONTROL_V2_FEATURE_CONTROL_HOLD,
  LOCAL_CONTROL_V2_FEATURE_CONTROL_TRACE,
  LOCAL_CONTROL_V2_FEATURE_SUBSCRIBE,
} from "./local-control-v2-features.ts";

export interface LocalControlV2Session {
  readonly bootId: string;
  dispose(): void;
  handleLine(line: string): void;
  readonly principalKind: LocalControlV2ClientHello["clientKind"];
  readonly principalRef?: string | undefined;
}

export interface CreateLocalControlV2SessionArgs {
  authorizer?: LocalControlAuthorizer | undefined;
  bootId: string;
  credentialStore?: AgentCallerCredentialStore | undefined;
  discovery?: AgentsDiscovery | undefined;
  emit: (frame: LocalControlV2ServerFrame) => void;
  features?: readonly string[] | undefined;
  nowMs?: (() => number) | undefined;
  receipts?: EffectReceiptStore | undefined;
}

export type CreateSessionFromHelloResult =
  | {
      ok: true;
      session: LocalControlV2Session;
      helloFrame: LocalControlV2ServerFrame;
    }
  | { ok: false; errorFrame: LocalControlV2ServerFrame };

export function createLocalControlV2SessionFromHello(
  hello: LocalControlV2ClientHello,
  args: CreateLocalControlV2SessionArgs
): CreateSessionFromHelloResult {
  const nowMs = args.nowMs ?? (() => Date.now());
  const store = args.credentialStore;
  const discovery = args.discovery ?? createStaticAgentsDiscovery();
  const authorizer = args.authorizer ?? createDefaultLocalControlAuthorizer();
  const receipts = args.receipts ?? createEffectReceiptStore();
  const { emit } = args;

  let material: AgentCallerCredentialMaterial | null = null;
  let principalRef: string | undefined;
  let disposed = false;
  const inflight = new Map<string, AbortController>();
  const subscriptions = new Map<
    string,
    { stream: string; requestId: string; revision: number }
  >();

  if (
    hello.clientKind === "external" ||
    hello.auth.method === "external-grant"
  ) {
    return {
      ok: false,
      errorFrame: serverErrorFrame(
        "unsupported",
        "external principal is not implemented in this build"
      ),
    };
  }

  if (hello.clientKind === "agent") {
    if (!store) {
      return {
        ok: false,
        errorFrame: serverErrorFrame(
          "auth_required",
          "binding store unavailable"
        ),
      };
    }
    if (hello.auth.method === "agent-binding") {
      const resolved = resolveAgentBinding({
        store,
        bindingId: hello.auth.bindingId,
        expectedBootId: args.bootId,
        nowMs: nowMs(),
      });
      if (!resolved.ok) {
        return {
          ok: false,
          errorFrame: serverErrorFrame(resolved.code, resolved.message),
        };
      }
      material = resolved.material;
    } else if (hello.auth.method === "agent-credential") {
      const resolved = resolveAgentCredential({
        store,
        credentialId: hello.auth.credentialId,
        secret: hello.auth.secret,
        expectedBootId: args.bootId,
        nowMs: nowMs(),
      });
      if (!resolved.ok) {
        return {
          ok: false,
          errorFrame: serverErrorFrame(resolved.code, resolved.message),
        };
      }
      material = resolved.material;
    } else {
      return {
        ok: false,
        errorFrame: serverErrorFrame(
          "auth_failed",
          "agent clientKind requires agent-binding (or optional agent-credential)"
        ),
      };
    }
    principalRef = `agent:${material.bootId}:${material.callerRuntimeId}:${material.callerGeneration}:${material.credentialId}`;
  } else if (hello.clientKind === "cli-human") {
    if (hello.auth.method !== "none") {
      return {
        ok: false,
        errorFrame: serverErrorFrame(
          "auth_failed",
          "cli-human requires auth.method none"
        ),
      };
    }
    principalRef = "human:peer";
  }

  const helloFrame: LocalControlV2ServerFrame = {
    apiVersion: LOCAL_CONTROL_V2_API_VERSION,
    type: "server.hello",
    requestId: hello.requestId,
    bootId: args.bootId,
    serverTimeMs: nowMs(),
    features: buildLocalControlV2Features(
      args.features ?? [],
      material,
      hello.clientKind
    ),
    ...(principalRef ? { principalRef } : {}),
  };

  const emitSafe = (frame: LocalControlV2ServerFrame) => {
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

  const session: LocalControlV2Session = {
    bootId: args.bootId,
    principalKind: hello.clientKind,
    principalRef,
    dispose() {
      disposed = true;
      for (const ac of inflight.values()) {
        ac.abort();
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
      const parsed = localControlV2ClientFrameSchema.safeParse(raw);
      if (!parsed.success) {
        const requestId =
          typeof raw === "object" &&
          raw !== null &&
          "requestId" in raw &&
          typeof (raw as { requestId: unknown }).requestId === "string"
            ? (raw as { requestId: string }).requestId
            : "unknown";
        emitSafe(
          v2ErrorResponse(
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
          v2ErrorResponse(
            frame.requestId,
            "protocol_unsupported",
            "client.hello only allowed as first frame"
          )
        );
        return;
      }
      if (frame.type === "client.auth-proof") {
        emitSafe(
          v2ErrorResponse(
            frame.requestId,
            "unsupported",
            "auth-proof is not implemented yet"
          )
        );
        return;
      }
      if (frame.type === "cancel") {
        const ac = inflight.get(frame.requestId);
        if (!ac) {
          emitSafe(
            v2ErrorResponse(
              frame.requestId,
              "not_found",
              "no in-flight request to cancel"
            )
          );
          return;
        }
        ac.abort();
        inflight.delete(frame.requestId);
        emitSafe({
          apiVersion: LOCAL_CONTROL_V2_API_VERSION,
          type: "response",
          requestId: frame.requestId,
          ok: true,
          data: { cancelled: true },
        });
        return;
      }
      if (frame.type === "subscribe") {
        handleSubscribe(frame.requestId, frame.stream, frame.after);
        return;
      }
      if (frame.type === "unsubscribe") {
        if (!subscriptions.has(frame.subscriptionId)) {
          emitSafe(
            v2ErrorResponse(
              frame.requestId,
              "not_found",
              "unknown subscriptionId"
            )
          );
          return;
        }
        subscriptions.delete(frame.subscriptionId);
        emitSafe({
          apiVersion: LOCAL_CONTROL_V2_API_VERSION,
          type: "response",
          requestId: frame.requestId,
          ok: true,
          data: { unsubscribed: true, subscriptionId: frame.subscriptionId },
        });
        return;
      }
      handleRequest(frame.requestId, frame.op, frame.params, frame.effectKey);
    },
  };

  function handleSubscribe(
    requestId: string,
    stream: string,
    after?: { bootId: string; revision: number }
  ) {
    if (
      stream !== "resource:agents" &&
      stream !== "resource:activity" &&
      stream !== "global"
    ) {
      emitSafe(
        v2ErrorResponse(
          requestId,
          "unsupported",
          `stream not implemented: ${stream}`
        )
      );
      return;
    }
    if (after && after.bootId !== args.bootId) {
      emitSafe(
        v2ErrorResponse(
          requestId,
          "snapshot_required",
          "boot_changed for cursor"
        )
      );
      return;
    }
    const auth = authorizeOp("agents.list", {});
    if (!auth.ok) {
      emitSafe(v2ErrorResponse(requestId, auth.code, auth.message));
      return;
    }
    const subscriptionId = `sub_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
    let revision = after?.revision ?? 0;
    subscriptions.set(subscriptionId, { stream, requestId, revision });
    emitSafe({
      apiVersion: LOCAL_CONTROL_V2_API_VERSION,
      type: "response",
      requestId,
      ok: true,
      data: { subscriptionId, stream },
    });
    revision += 1;
    const sub = subscriptions.get(subscriptionId);
    if (sub) {
      sub.revision = revision;
    }
    const payload =
      stream === "resource:agents" || stream === "global"
        ? discovery.listRunning()
        : { activities: [], note: "activity stream stub" };
    emitSafe({
      apiVersion: LOCAL_CONTROL_V2_API_VERSION,
      type: "event",
      subscriptionId,
      bootId: args.bootId,
      revision,
      cursorScope: stream === "global" ? "global" : stream,
      mode: after ? "resume" : "snapshot",
      payload,
    });
  }

  function handleRequest(
    requestId: string,
    op: string,
    params: Record<string, unknown>,
    effectKey?: string
  ) {
    const auth = authorizeOp(op, params, effectKey);
    if (!auth.ok) {
      emitSafe(v2ErrorResponse(requestId, auth.code, auth.message));
      return;
    }
    if (LOCAL_CONTROL_WRITE_OPS.has(op) && effectKey && principalRef) {
      const digest = digestRequestParams(params);
      const existing = receipts.lookup({ principalRef, op, effectKey });
      if (existing) {
        if (existing.digest !== digest) {
          emitSafe(
            v2ErrorResponse(
              requestId,
              "idempotency_conflict",
              "effectKey reused with different params"
            )
          );
          return;
        }
        emitSafe({
          apiVersion: LOCAL_CONTROL_V2_API_VERSION,
          type: "response",
          requestId,
          ok: true,
          data: existing.responseData,
          meta: { effectRevision: existing.effectRevision },
        });
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
      if (inflight.has(requestId)) {
        emitSafe(
          v2ErrorResponse(
            requestId,
            "effect_in_progress",
            "request already in flight"
          )
        );
        return;
      }
      const msRaw = params.ms;
      const ms =
        typeof msRaw === "number" && Number.isFinite(msRaw)
          ? Math.min(Math.max(0, msRaw), 30_000)
          : 50;
      const ac = new AbortController();
      inflight.set(requestId, ac);
      const timer = setTimeout(() => {
        if (ac.signal.aborted || disposed) {
          return;
        }
        inflight.delete(requestId);
        emitSafe({
          apiVersion: LOCAL_CONTROL_V2_API_VERSION,
          type: "response",
          requestId,
          ok: true,
          data: { heldMs: ms },
        });
      }, ms);
      ac.signal.addEventListener("abort", () => clearTimeout(timer));
      return;
    }
    emitSafe(
      v2ErrorResponse(requestId, "unsupported", `op not implemented: ${op}`)
    );
  }

  return { ok: true, session, helloFrame };
}
