/**
 * v2 hello → principal 解析（与 session 分离以控制文件行数）。
 */
import type { AgentCallerCredentialMaterial } from "@shared/contracts/local-control/agent-credential.ts";
import type {
  LocalControlClientHello,
  LocalControlServerFrame,
} from "@shared/contracts/local-control/frames.ts";
import type { AgentCallerCredentialStore } from "../../../services/agent-caller/credential-store.ts";
import {
  resolveAgentBinding,
  resolveAgentCredential,
} from "../../../services/agent-caller/credential-store.ts";
import { serverErrorFrame } from "./features.ts";

export type HelloPrincipalResult =
  | {
      ok: true;
      material: AgentCallerCredentialMaterial | null;
      principalRef: string | undefined;
    }
  | { ok: false; errorFrame: LocalControlServerFrame };

export function resolveHelloPrincipal(args: {
  hello: LocalControlClientHello;
  bootId: string;
  store?: AgentCallerCredentialStore | undefined;
  nowMs: number;
}): HelloPrincipalResult {
  const { hello, bootId, store, nowMs } = args;

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
    let material: AgentCallerCredentialMaterial;
    if (hello.auth.method === "agent-binding") {
      const resolved = resolveAgentBinding({
        store,
        bindingId: hello.auth.bindingId,
        expectedBootId: bootId,
        nowMs,
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
        expectedBootId: bootId,
        nowMs,
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
    return {
      ok: true,
      material,
      principalRef: `agent:${material.bootId}:${material.callerRuntimeId}:${material.callerGeneration}:${material.credentialId}`,
    };
  }

  if (hello.clientKind === "cli-human") {
    if (hello.auth.method !== "none") {
      return {
        ok: false,
        errorFrame: serverErrorFrame(
          "auth_failed",
          "cli-human requires auth.method none"
        ),
      };
    }
    return { ok: true, material: null, principalRef: "human:peer" };
  }

  return {
    ok: false,
    errorFrame: serverErrorFrame(
      "permission_denied",
      "principal not authorized"
    ),
  };
}
