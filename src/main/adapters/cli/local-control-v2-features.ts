/**
 * v2 feature 广告与 server.error 帧构造。
 */
import type { AgentCallerCredentialMaterial } from "@shared/contracts/local-control/agent-credential.ts";
import {
  LOCAL_CONTROL_V2_API_VERSION,
  type LocalControlV2ErrorCode,
} from "@shared/contracts/local-control/v2-errors.ts";
import type {
  LocalControlV2ClientHello,
  LocalControlV2ServerFrame,
} from "@shared/contracts/local-control/v2-frames.ts";

export const LOCAL_CONTROL_V2_FEATURE_AGENTS_SELF = "agents.self";
export const LOCAL_CONTROL_V2_FEATURE_AGENTS_CATALOG = "agents.catalog";
export const LOCAL_CONTROL_V2_FEATURE_AGENTS_LIST = "agents.list";
export const LOCAL_CONTROL_V2_FEATURE_AGENTS_GET = "agents.get";
export const LOCAL_CONTROL_V2_FEATURE_CONTROL_HOLD = "control.hold";
export const LOCAL_CONTROL_V2_FEATURE_CONTROL_TRACE = "control.trace";
export const LOCAL_CONTROL_V2_FEATURE_SUBSCRIBE = "stream.subscribe";

const BASE_ADVERTISED_FEATURES = [
  LOCAL_CONTROL_V2_FEATURE_AGENTS_CATALOG,
  LOCAL_CONTROL_V2_FEATURE_AGENTS_LIST,
  LOCAL_CONTROL_V2_FEATURE_AGENTS_GET,
  LOCAL_CONTROL_V2_FEATURE_CONTROL_HOLD,
  LOCAL_CONTROL_V2_FEATURE_CONTROL_TRACE,
  LOCAL_CONTROL_V2_FEATURE_SUBSCRIBE,
] as const;

export function serverErrorFrame(
  code: LocalControlV2ErrorCode,
  message: string
): LocalControlV2ServerFrame {
  return {
    apiVersion: LOCAL_CONTROL_V2_API_VERSION,
    type: "server.error",
    code,
    message,
  };
}

export function buildLocalControlV2Features(
  base: readonly string[],
  material: AgentCallerCredentialMaterial | null,
  clientKind: LocalControlV2ClientHello["clientKind"]
): string[] {
  const set = new Set(base);
  for (const f of BASE_ADVERTISED_FEATURES) {
    set.add(f);
  }
  if (clientKind === "agent" && material?.operations.includes("agents.self")) {
    set.add(LOCAL_CONTROL_V2_FEATURE_AGENTS_SELF);
  }
  return [...set];
}
