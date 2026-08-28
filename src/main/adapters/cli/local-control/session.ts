import { LOCAL_CONTROL_API_VERSION } from "@shared/contracts/local-control/errors.ts";
import {
  type LocalControlClientHello,
  type LocalControlServerFrame,
  localControlClientFrameSchema,
} from "@shared/contracts/local-control/frames.ts";
import type { CapabilityAuthority } from "../../../services/capability/authority.ts";
import type { ControlSnapshotService } from "../../../services/control-snapshot/service.ts";
import type { RuntimeControlService } from "../../../services/runtime-control/service.ts";
import {
  type AgentsDiscovery,
  createStaticAgentsDiscovery,
} from "./agents-discovery.ts";
import {
  createDefaultLocalControlAuthorizer,
  type LocalControlAuthorizer,
} from "./authorize.ts";
import type { ResolveOriginPanel } from "./capability-hot-path.ts";
import { controlErrorResponse } from "./discovery.ts";
import { buildLocalControlFeatures, serverErrorFrame } from "./features.ts";
import {
  type MobileAuthenticator,
  resolveHelloPrincipal,
} from "./hello-auth.ts";
import {
  createEffectReceiptStore,
  type EffectReceiptStore,
} from "./receipts.ts";
import { dispatchSessionRequest } from "./session-dispatch.ts";
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
  /** mobile-paired hello 认证钩子（remote-control 装配注入）；缺省时 mobile-paired 一律 auth_failed。 */
  authenticateMobile?: MobileAuthenticator | undefined;
  authorizer?: LocalControlAuthorizer | undefined;
  bootId: string;
  capabilityAuthority?: CapabilityAuthority | undefined;
  discovery?: AgentsDiscovery | undefined;
  emit: (frame: LocalControlServerFrame) => void;
  features?: readonly string[] | undefined;
  nowMs?: (() => number) | undefined;
  receipts?: EffectReceiptStore | undefined;
  resolveOriginPanel?: ResolveOriginPanel | undefined;
  runtimeControl?: RuntimeControlService | undefined;
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
  const discovery = args.discovery ?? createStaticAgentsDiscovery();
  const authorizer = args.authorizer ?? createDefaultLocalControlAuthorizer();
  const receipts = args.receipts ?? createEffectReceiptStore();
  const { emit } = args;

  let disposed = false;
  const inflight: InflightMap = new Map();
  const subscriptions = new Map<string, SubscriptionRecord>();

  const principal = resolveHelloPrincipal(hello, args.authenticateMobile);
  if (!principal.ok) {
    return { ok: false, errorFrame: principal.errorFrame };
  }
  const principalRef = principal.principalRef;
  const helloFrame: LocalControlServerFrame = {
    apiVersion: LOCAL_CONTROL_API_VERSION,
    type: "server.hello",
    requestId: hello.requestId,
    bootId: args.bootId,
    serverTimeMs: nowMs(),
    features: buildLocalControlFeatures(args.features ?? []),
    principalRef,
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
      op,
      params,
      effectKey,
    });

  const session: LocalControlSession = {
    bootId: args.bootId,
    principalKind: hello.clientKind,
    get principalRef() {
      return principalRef;
    },
    dispose() {
      disposed = true;
      for (const entry of inflight.values()) {
        entry.ac.abort();
      }
      inflight.clear();
      subscriptions.clear();
    },
    handleLine(line: string) {
      if (disposed) {
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
          ...(frame.after === undefined
            ? {}
            : {
                after: {
                  bootId: frame.after.bootId ?? args.bootId,
                  revision: frame.after.revision,
                  ...(frame.after.scope === undefined
                    ? {}
                    : { scope: frame.after.scope }),
                },
              }),
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
          data: {
            unsubscribed: true,
            subscriptionId: frame.subscriptionId,
          },
        });
        return;
      }
      if (frame.type !== "request") {
        const unknownFrame = frame as {
          readonly requestId?: unknown;
          readonly type: string;
        };
        const requestId =
          typeof unknownFrame.requestId === "string"
            ? unknownFrame.requestId
            : "unknown";
        emitSafe(
          controlErrorResponse(
            requestId,
            "unsupported",
            `frame type not supported: ${unknownFrame.type}`
          )
        );
        return;
      }
      dispatchSessionRequest({
        requestId: frame.requestId,
        op: frame.op,
        params: frame.params,
        effectKey: frame.effectKey,
        expectedBootId: frame.expectedBootId,
        bootId: args.bootId,
        principalRef,
        discovery,
        receipts,
        runtimeControl: args.runtimeControl,
        capabilityAuthority: args.capabilityAuthority,
        resolveOriginPanel: args.resolveOriginPanel,
        snapshotService: args.snapshotService,
        inflight,
        disposed: () => disposed,
        nowMs,
        authorizeOp,
        emit: emitSafe,
      });
    },
  };

  return { ok: true, session, helloFrame };
}
