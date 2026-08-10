/**
 * v2 统一 authorize 钩子（架构闭环）。
 * 后续 CapabilityAuthority 可替换 default 实现，session 不必改分支。
 */
import type { AgentCallerCredentialMaterial } from "@shared/contracts/local-control/agent-credential.ts";
import type { LocalControlV2ErrorCode } from "@shared/contracts/local-control/v2-errors.ts";
import type { LocalControlV2ClientHello } from "@shared/contracts/local-control/v2-frames.ts";

export interface LocalControlAuthorizeInput {
  effectKey?: string | undefined;
  material: AgentCallerCredentialMaterial | null;
  op: string;
  params: Record<string, unknown>;
  principalKind: LocalControlV2ClientHello["clientKind"];
  principalRef?: string | undefined;
}

export type LocalControlAuthorizeResult =
  | { ok: true }
  | { ok: false; code: LocalControlV2ErrorCode; message: string };

export interface LocalControlAuthorizer {
  authorize(input: LocalControlAuthorizeInput): LocalControlAuthorizeResult;
}

/** 需要 effectKey 的写/围栏类 op（可扩展）。 */
export const LOCAL_CONTROL_WRITE_OPS = new Set<string>([
  "control.trace",
  "agents.invoke",
  "agents.start",
  "agents.turn",
  "agents.interrupt",
  "agents.terminate",
]);

/** agent 默认可调用的 control 探针（非 control.* 前缀通配）。 */
const AGENT_CONTROL_PROBE_OPS = new Set(["control.hold", "control.trace"]);

const HUMAN_ALLOWED = new Set([
  "agents.catalog",
  "agents.list",
  "agents.get",
  "control.hold",
  "control.trace",
]);

/**
 * ≥128-bit 不透明 effectKey：base64url/hex 字符，长度 ≥ 22（≈128 bit@6bit/char）。
 * 拒绝过短或非 URL-safe 字母表。
 */
export function isStrongEffectKey(effectKey: string): boolean {
  if (effectKey.length < 22) {
    return false;
  }
  return /^[A-Za-z0-9_-]+$/.test(effectKey);
}

function isDiscovery(op: string): boolean {
  return op === "agents.catalog" || op === "agents.list" || op === "agents.get";
}

/**
 * 默认授权：
 * - cli-human：发现 + 架构探针（hold/trace）
 * - agent：显式 control 探针 + 凭证 operations + 只读发现
 * - 写 op 必须带 ≥128-bit effectKey
 */
export function createDefaultLocalControlAuthorizer(): LocalControlAuthorizer {
  return {
    authorize(input) {
      const { op, principalKind, material, effectKey } = input;

      if (
        LOCAL_CONTROL_WRITE_OPS.has(op) &&
        !(effectKey && isStrongEffectKey(effectKey))
      ) {
        return {
          ok: false,
          code: "invalid_command",
          message:
            "write op requires effectKey (>=128-bit opaque, base64url/hex, len>=22)",
        };
      }

      if (principalKind === "cli-human") {
        if (op === "agents.self") {
          return {
            ok: false,
            code: "permission_denied",
            message: "agents.self requires agent principal",
          };
        }
        if (!HUMAN_ALLOWED.has(op)) {
          return {
            ok: false,
            code: "permission_denied",
            message: `cli-human cannot call ${op}`,
          };
        }
        return { ok: true };
      }

      if (principalKind === "agent") {
        if (!material) {
          return {
            ok: false,
            code: "auth_required",
            message: "agent principal missing credential",
          };
        }
        if (AGENT_CONTROL_PROBE_OPS.has(op)) {
          return { ok: true };
        }
        if (material.operations.includes(op) || isDiscovery(op)) {
          return { ok: true };
        }
        return {
          ok: false,
          code: "permission_denied",
          message: `credential does not allow ${op}`,
        };
      }

      return {
        ok: false,
        code: "permission_denied",
        message: "principal not authorized",
      };
    },
  };
}
