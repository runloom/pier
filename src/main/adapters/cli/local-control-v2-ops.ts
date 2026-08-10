/**
 * v2 会话内同步 op 处理（发现 / self / trace）。
 */
import {
  type AgentCallerCredentialMaterial,
  toAgentSelfSnapshot,
} from "@shared/contracts/local-control/agent-credential.ts";
import {
  LOCAL_CONTROL_V2_API_VERSION,
  type LocalControlV2ErrorCode,
} from "@shared/contracts/local-control/v2-errors.ts";
import type { LocalControlV2ServerFrame } from "@shared/contracts/local-control/v2-frames.ts";
import type { AgentsDiscovery } from "./agents-discovery.ts";
import { findRunningAgent } from "./agents-discovery.ts";
import {
  digestRequestParams,
  type EffectReceiptStore,
} from "./local-control-receipts.ts";

export function v2ErrorResponse(
  requestId: string,
  code: LocalControlV2ErrorCode,
  message: string
): LocalControlV2ServerFrame {
  return {
    apiVersion: LOCAL_CONTROL_V2_API_VERSION,
    type: "response",
    requestId,
    ok: false,
    error: { code, message },
  };
}

export function handleAgentsSelfOp(args: {
  requestId: string;
  material: AgentCallerCredentialMaterial | null;
  principalRef?: string;
  nowMs: number;
}): LocalControlV2ServerFrame {
  const { requestId, material, principalRef, nowMs } = args;
  if (!(material && principalRef)) {
    return v2ErrorResponse(
      requestId,
      "permission_denied",
      "agents.self requires authenticated agent principal"
    );
  }
  if (material.expiresAt <= nowMs) {
    return v2ErrorResponse(requestId, "auth_failed", "credential expired");
  }
  return {
    apiVersion: LOCAL_CONTROL_V2_API_VERSION,
    type: "response",
    requestId,
    ok: true,
    data: { self: toAgentSelfSnapshot(material, principalRef) },
  };
}

export function handleDiscoveryOp(args: {
  requestId: string;
  op: string;
  params: Record<string, unknown>;
  discovery: AgentsDiscovery;
}): LocalControlV2ServerFrame {
  const { requestId, op, params, discovery } = args;
  if (op === "agents.catalog") {
    return {
      apiVersion: LOCAL_CONTROL_V2_API_VERSION,
      type: "response",
      requestId,
      ok: true,
      data: { agents: discovery.listCatalog() },
    };
  }
  if (op === "agents.list") {
    const snapshot = discovery.listRunning();
    return {
      apiVersion: LOCAL_CONTROL_V2_API_VERSION,
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
    return v2ErrorResponse(
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
    return v2ErrorResponse(
      requestId,
      "invalid_command",
      "multiple agents match agentId; pass agentRef"
    );
  }
  if (!found) {
    return v2ErrorResponse(requestId, "not_found", "agent not found");
  }
  return {
    apiVersion: LOCAL_CONTROL_V2_API_VERSION,
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
  principalRef?: string;
  receipts: EffectReceiptStore;
  nowMs: number;
}): LocalControlV2ServerFrame {
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
      responseData,
    });
  }
  return {
    apiVersion: LOCAL_CONTROL_V2_API_VERSION,
    type: "response",
    requestId,
    ok: true,
    data: responseData,
    meta: { effectRevision },
  };
}
