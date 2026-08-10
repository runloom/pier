/**
 * AgentCaller 凭证内存索引。
 * hello 必须同时提交 credentialId + secret；id  alone 不可冒充。
 */
import {
  type AgentCallerCredentialMaterial,
  agentCallerCredentialMaterialSchema,
} from "@shared/contracts/local-control/agent-credential.ts";

export interface AgentCallerCredentialStore {
  clear(): void;
  delete(credentialId: string): void;
  get(credentialId: string): AgentCallerCredentialMaterial | undefined;
  put(material: AgentCallerCredentialMaterial): void;
  size(): number;
}

export function createAgentCallerCredentialStore(): AgentCallerCredentialStore {
  const byId = new Map<string, AgentCallerCredentialMaterial>();

  return {
    put(material) {
      const parsed = agentCallerCredentialMaterialSchema.parse(material);
      byId.set(parsed.credentialId, parsed);
    },
    get(credentialId) {
      return byId.get(credentialId);
    },
    delete(credentialId) {
      byId.delete(credentialId);
    },
    clear() {
      byId.clear();
    },
    size() {
      return byId.size;
    },
  };
}

export type ResolveAgentCredentialResult =
  | { ok: true; material: AgentCallerCredentialMaterial }
  | { ok: false; code: "auth_failed" | "auth_required"; message: string };

export function resolveAgentCredential(args: {
  store: AgentCallerCredentialStore;
  credentialId: string;
  /** 持有证明；必须与 material.secret 常量时间比较意图（见实现） */
  secret: string;
  expectedBootId: string;
  nowMs?: number;
}): ResolveAgentCredentialResult {
  const material = args.store.get(args.credentialId);
  if (!material) {
    return {
      ok: false,
      code: "auth_failed",
      message: "unknown credential",
    };
  }
  if (!(args.secret && secretsEqual(material.secret, args.secret))) {
    return {
      ok: false,
      code: "auth_failed",
      message: "invalid credential secret",
    };
  }
  if (material.bootId !== args.expectedBootId) {
    return {
      ok: false,
      code: "auth_failed",
      message: "credential boot mismatch",
    };
  }
  const now = args.nowMs ?? Date.now();
  if (material.expiresAt <= now) {
    return {
      ok: false,
      code: "auth_failed",
      message: "credential expired",
    };
  }
  return { ok: true, material };
}

/** 避免短 secret 上的简单时序泄漏；长度不同仍立即失败。 */
function secretsEqual(a: string, b: string): boolean {
  if (a.length !== b.length) {
    return false;
  }
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) {
    // biome-ignore lint/suspicious/noBitwiseOperators: constant-time secret compare
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}
