/**
 * Agent caller binding 内存索引。
 * 默认路径：bindingId + boot + 未过期 即可（本机纪律）。
 * 可选路径：material 含 secret 时 agent-credential 做持有证明。
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

function checkMaterialLive(
  material: AgentCallerCredentialMaterial | undefined,
  expectedBootId: string,
  nowMs: number
): ResolveAgentCredentialResult {
  if (!material) {
    return {
      ok: false,
      code: "auth_failed",
      message: "unknown binding",
    };
  }
  if (material.bootId !== expectedBootId) {
    return {
      ok: false,
      code: "auth_failed",
      message: "binding boot mismatch",
    };
  }
  if (material.expiresAt <= nowMs) {
    return {
      ok: false,
      code: "auth_failed",
      message: "binding expired",
    };
  }
  return { ok: true, material };
}

/** 本机默认：仅 bindingId（宿主 store 签发过的不透明 id） */
export function resolveAgentBinding(args: {
  store: AgentCallerCredentialStore;
  bindingId: string;
  expectedBootId: string;
  nowMs?: number;
}): ResolveAgentCredentialResult {
  const now = args.nowMs ?? Date.now();
  return checkMaterialLive(
    args.store.get(args.bindingId),
    args.expectedBootId,
    now
  );
}

/**
 * 可选增强：binding + secret。
 * material 未签发 secret 时拒绝 agent-credential 方法。
 */
export function resolveAgentCredential(args: {
  store: AgentCallerCredentialStore;
  credentialId: string;
  secret: string;
  expectedBootId: string;
  nowMs?: number;
}): ResolveAgentCredentialResult {
  const now = args.nowMs ?? Date.now();
  const live = checkMaterialLive(
    args.store.get(args.credentialId),
    args.expectedBootId,
    now
  );
  if (!live.ok) {
    return live;
  }
  const expectedSecret = live.material.secret;
  if (
    !(
      expectedSecret &&
      args.secret &&
      secretsEqual(expectedSecret, args.secret)
    )
  ) {
    return {
      ok: false,
      code: "auth_failed",
      message: "invalid credential secret",
    };
  }
  return live;
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
