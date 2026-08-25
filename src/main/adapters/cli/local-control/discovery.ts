/**
 * v2 会话：发现类与探针 op（catalog / list / get / self / trace）。
 */
import {
  LOCAL_CONTROL_API_VERSION,
  type LocalControlErrorCode,
} from "@shared/contracts/local-control/errors.ts";
import type { LocalControlServerFrame } from "@shared/contracts/local-control/frames.ts";
import type { AgentsDiscovery } from "./agents-discovery.ts";
import { findRunningAgent } from "./agents-discovery.ts";
import { digestRequestParams, type EffectReceiptStore } from "./receipts.ts";

export function controlErrorResponse(
  requestId: string,
  code: LocalControlErrorCode,
  message: string,
  details?: unknown
): LocalControlServerFrame {
  return {
    apiVersion: LOCAL_CONTROL_API_VERSION,
    type: "response",
    requestId,
    ok: false,
    error: { code, message, ...(details === undefined ? {} : { details }) },
  };
}

export function handleDiscoveryOp(args: {
  requestId: string;
  op: string;
  params: Record<string, unknown>;
  discovery: AgentsDiscovery;
}): LocalControlServerFrame {
  const { requestId, op, params, discovery } = args;
  if (op === "agents.catalog") {
    return {
      apiVersion: LOCAL_CONTROL_API_VERSION,
      type: "response",
      requestId,
      ok: true,
      data: { agents: discovery.listCatalog() },
    };
  }
  if (op === "agents.list") {
    const snapshot = discovery.listRunning();
    return {
      apiVersion: LOCAL_CONTROL_API_VERSION,
      type: "response",
      requestId,
      ok: true,
      data: { entries: snapshot.entries, ts: snapshot.ts },
    };
  }
  const agentRef =
    typeof params.agentRef === "string" ? params.agentRef : undefined;
  const agentId =
    typeof params.agentId === "string" ? params.agentId : undefined;
  const panelId =
    typeof params.panelId === "string" ? params.panelId : undefined;
  if (!(agentRef || agentId || panelId)) {
    return controlErrorResponse(
      requestId,
      "invalid_command",
      "agents.get requires agentRef, agentId, or panelId"
    );
  }
  const found = findRunningAgent(discovery.listRunning(), {
    agentRef,
    agentId,
    panelId,
  });
  if (found && "ambiguous" in found && found.ambiguous) {
    return controlErrorResponse(
      requestId,
      "invalid_command",
      "multiple agents match agentId; pass agentRef"
    );
  }
  if (!found) {
    return controlErrorResponse(requestId, "not_found", "agent not found");
  }
  return {
    apiVersion: LOCAL_CONTROL_API_VERSION,
    type: "response",
    requestId,
    ok: true,
    data: { agent: found },
  };
}

export function handleTraceOp(args: {
  requestId: string;
  params: Record<string, unknown>;
  effectKey: string;
  principalRef?: string | undefined;
  receipts: EffectReceiptStore;
  nowMs: number;
}): LocalControlServerFrame {
  const { requestId, params, effectKey, principalRef, receipts, nowMs } = args;
  const effectRevision = receipts.nextRevision();
  const responseData = {
    traced: true,
    note: typeof params.note === "string" ? params.note : null,
    at: nowMs,
  };
  if (principalRef && effectKey) {
    receipts.commit({
      effectKey,
      op: "control.trace",
      principalRef,
      digest: digestRequestParams(params),
      effectRevision,
      ok: true,
      responseData,
    });
  }
  return {
    apiVersion: LOCAL_CONTROL_API_VERSION,
    type: "response",
    requestId,
    ok: true,
    data: responseData,
    meta: { effectRevision },
  };
}
