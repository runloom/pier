/**
 * v2 subscribe / unsubscribe 处理（从 session 拆出以控制文件行数）。
 */
import { randomUUID } from "node:crypto";
import { LOCAL_CONTROL_V2_API_VERSION } from "@shared/contracts/local-control/v2-errors.ts";
import type { LocalControlV2ServerFrame } from "@shared/contracts/local-control/v2-frames.ts";
import type { AgentsDiscovery } from "./agents-discovery.ts";
import type { LocalControlAuthorizeResult } from "./local-control-authorize.ts";
import { v2ErrorResponse } from "./local-control-v2-ops.ts";

export interface SubscriptionRecord {
  requestId: string;
  revision: number;
  stream: string;
}

export function handleV2Subscribe(args: {
  requestId: string;
  stream: string;
  after?: { bootId: string; revision: number };
  bootId: string;
  discovery: AgentsDiscovery;
  subscriptions: Map<string, SubscriptionRecord>;
  authorizeList: () => LocalControlAuthorizeResult;
  emit: (frame: LocalControlV2ServerFrame) => void;
}): void {
  const {
    requestId,
    stream,
    after,
    bootId,
    discovery,
    subscriptions,
    authorizeList,
    emit,
  } = args;

  if (
    stream !== "resource:agents" &&
    stream !== "resource:activity" &&
    stream !== "global"
  ) {
    emit(
      v2ErrorResponse(
        requestId,
        "unsupported",
        `stream not implemented: ${stream}`
      )
    );
    return;
  }
  if (after && after.bootId !== bootId) {
    emit(
      v2ErrorResponse(requestId, "snapshot_required", "boot_changed for cursor")
    );
    return;
  }
  const auth = authorizeList();
  if (!auth.ok) {
    emit(v2ErrorResponse(requestId, auth.code, auth.message));
    return;
  }
  const subscriptionId = `sub_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
  let revision = after?.revision ?? 0;
  subscriptions.set(subscriptionId, { stream, requestId, revision });
  emit({
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
  emit({
    apiVersion: LOCAL_CONTROL_V2_API_VERSION,
    type: "event",
    subscriptionId,
    bootId,
    revision,
    cursorScope: stream === "global" ? "global" : stream,
    mode: after ? "resume" : "snapshot",
    payload,
  });
}
