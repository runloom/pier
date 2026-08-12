/**
 * v2 subscribe / unsubscribe 处理（从 session 拆出以控制文件行数）。
 * W6-S5：cursor 续接与 control.watch 共用 assertCursorResume。
 */
import { randomUUID } from "node:crypto";
import {
  CONTROL_CURSOR_SCOPE_GLOBAL,
  CONTROL_CURSOR_SCOPE_RESOURCE_ACTIVITY,
  CONTROL_CURSOR_SCOPE_RESOURCE_AGENTS,
} from "@shared/contracts/local-control/cursor.ts";
import { LOCAL_CONTROL_API_VERSION } from "@shared/contracts/local-control/errors.ts";
import type { LocalControlServerFrame } from "@shared/contracts/local-control/frames.ts";
import type { AgentsDiscovery } from "./agents-discovery.ts";
import type { LocalControlAuthorizeResult } from "./authorize.ts";
import { assertCursorResume } from "./cursor-gate.ts";
import { controlErrorResponse } from "./discovery.ts";

export interface SubscriptionRecord {
  requestId: string;
  revision: number;
  stream: string;
}

function cursorScopeForStream(stream: string): string {
  if (stream === "global") {
    return CONTROL_CURSOR_SCOPE_GLOBAL;
  }
  if (stream === "resource:agents") {
    return CONTROL_CURSOR_SCOPE_RESOURCE_AGENTS;
  }
  if (stream === "resource:activity") {
    return CONTROL_CURSOR_SCOPE_RESOURCE_ACTIVITY;
  }
  return stream;
}

export function handleControlSubscribe(args: {
  requestId: string;
  stream: string;
  after?: { bootId: string; revision: number; scope?: string };
  bootId: string;
  discovery: AgentsDiscovery;
  subscriptions: Map<string, SubscriptionRecord>;
  authorizeList: () => LocalControlAuthorizeResult;
  emit: (frame: LocalControlServerFrame) => void;
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
      controlErrorResponse(
        requestId,
        "unsupported",
        `stream not implemented: ${stream}`
      )
    );
    return;
  }

  const expectedScope = cursorScopeForStream(stream);
  const gate = assertCursorResume({
    after: after
      ? {
          bootId: after.bootId,
          revision: after.revision,
          ...(after.scope
            ? {
                scope: after.scope as
                  | typeof CONTROL_CURSOR_SCOPE_GLOBAL
                  | typeof CONTROL_CURSOR_SCOPE_RESOURCE_AGENTS
                  | typeof CONTROL_CURSOR_SCOPE_RESOURCE_ACTIVITY,
              }
            : {}),
        }
      : undefined,
    sessionBootId: bootId,
    expectedScope,
  });
  if (!gate.ok) {
    emit(controlErrorResponse(requestId, gate.code, gate.message));
    return;
  }

  const auth = authorizeList();
  if (!auth.ok) {
    emit(controlErrorResponse(requestId, auth.code, auth.message));
    return;
  }
  const subscriptionId = `sub_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
  // resume：从 after.revision 之后一条起；snapshot：从 0 起再 +1 发首包
  let revision =
    gate.mode === "resume" ? gate.revision : Math.max(0, gate.revision);
  subscriptions.set(subscriptionId, { stream, requestId, revision });
  emit({
    apiVersion: LOCAL_CONTROL_API_VERSION,
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
    apiVersion: LOCAL_CONTROL_API_VERSION,
    type: "event",
    subscriptionId,
    bootId,
    revision,
    cursorScope: expectedScope,
    mode: gate.mode === "resume" ? "resume" : "snapshot",
    payload,
  });
}
