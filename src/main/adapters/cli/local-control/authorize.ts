/**
 * v2 统一 authorize 钩子。
 * 产品终态：仅 cli-human（op allowlist + effectKey）。
 */
import type { LocalControlErrorCode } from "@shared/contracts/local-control/errors.ts";
import type { LocalControlClientHello } from "@shared/contracts/local-control/frames.ts";
import { AGENTS_RUNTIME_OPS, AGENTS_RUNTIME_WRITE_OPS } from "./features.ts";

export interface LocalControlAuthorizeInput {
  effectKey?: string | undefined;
  op: string;
  params: Record<string, unknown>;
  principalKind: LocalControlClientHello["clientKind"];
  principalRef?: string | undefined;
}

export type LocalControlAuthorizeResult =
  | { ok: true }
  | { ok: false; code: LocalControlErrorCode; message: string };

export interface LocalControlAuthorizer {
  authorize(input: LocalControlAuthorizeInput): LocalControlAuthorizeResult;
}

/** 可注入扩展点；当前无字段，保留命名 options 便于测试/未来接线。 */
export type CreateLocalControlAuthorizerOptions = Record<string, never>;

/** 需要 effectKey 的写/围栏类 op。 */
export const LOCAL_CONTROL_WRITE_OPS = new Set<string>([
  "control.trace",
  ...AGENTS_RUNTIME_WRITE_OPS,
]);

const HUMAN_ALLOWED = new Set([
  "agents.catalog",
  "agents.list",
  "agents.get",
  ...AGENTS_RUNTIME_OPS,
  "control.hold",
  "control.trace",
  "control.snapshot",
  "control.watch",
]);

/**
 * ≥128-bit 不透明 effectKey：base64url/hex 字符，长度 ≥ 22。
 */
export function isStrongEffectKey(effectKey: string): boolean {
  if (effectKey.length < 22) {
    return false;
  }
  return /^[A-Za-z0-9_-]+$/.test(effectKey);
}

export function createDefaultLocalControlAuthorizer(
  _options: CreateLocalControlAuthorizerOptions = {}
): LocalControlAuthorizer {
  return {
    authorize(input) {
      const { op, principalKind, effectKey } = input;

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
            code: "unsupported",
            message: "agents.self is not a product path",
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

      return {
        ok: false,
        code: "permission_denied",
        message: "principal not authorized",
      };
    },
  };
}
