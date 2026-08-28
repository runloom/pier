/**
 * 移动端 authorizer：epoch 门（assertLive）+ 只读 op 白名单。
 * assertLive 由装配侧注入（PairingService.assertEpochCurrent 绑定设备）；
 * 吊销/epoch 失效即 device_revoked。
 */
import type { LocalControlAuthorizer } from "../cli/local-control/authorize.ts";

/** 移动端只读 op 白名单。 */
export const MOBILE_ALLOWED = [
  "control.snapshot",
  "control.watch",
  "agents.catalog",
  "agents.list",
  "agents.get",
] as const;

const MOBILE_ALLOWED_BY_OP = Object.fromEntries(
  MOBILE_ALLOWED.map((op) => [op, true])
) as Record<string, true>;

export function createMobileAuthorizer(
  assertLive: () => boolean
): LocalControlAuthorizer {
  return {
    authorize(input) {
      if (!assertLive()) {
        return {
          ok: false,
          code: "device_revoked",
          message: "paired device revoked or token epoch stale",
        };
      }
      if (!MOBILE_ALLOWED_BY_OP[input.op]) {
        return {
          ok: false,
          code: "permission_denied",
          message: `mobile-paired cannot call ${input.op}`,
        };
      }
      return { ok: true };
    },
  };
}
