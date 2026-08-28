/**
 * v2 hello → principal 解析。
 * cli-human（auth.method none）免认证；mobile-paired 持配对设备令牌，
 * 由注入的 MobileAuthenticator 认证（装配见 remote-control 适配器）。
 */
import type {
  LocalControlClientHello,
  LocalControlServerFrame,
} from "@shared/contracts/local-control/frames.ts";
import type { PierCompanionShell } from "@shared/contracts/remote.ts";
import { serverErrorFrame } from "./features.ts";

export type HelloPrincipalResult =
  | {
      ok: true;
      principalRef: string;
    }
  | { ok: false; errorFrame: LocalControlServerFrame };

/** 移动端 hello 认证钩子：实现侧包装 PairingService.authenticate。 */
export type MobileAuthenticator = (auth: {
  deviceId: string;
  deviceToken: string;
  shell: PierCompanionShell;
}) => { ok: true; principalRef: string } | { ok: false };

export function resolveHelloPrincipal(
  hello: LocalControlClientHello,
  authenticateMobile?: MobileAuthenticator
): HelloPrincipalResult {
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
    return { ok: true, principalRef: "human:peer" };
  }

  if (hello.auth.method !== "device-token" || !authenticateMobile) {
    return {
      ok: false,
      errorFrame: serverErrorFrame(
        "auth_failed",
        "mobile-paired requires device-token authentication"
      ),
    };
  }
  const mobile = authenticateMobile({
    deviceId: hello.auth.deviceId,
    deviceToken: hello.auth.deviceToken,
    shell: hello.auth.shell,
  });
  if (!mobile.ok) {
    return {
      ok: false,
      errorFrame: serverErrorFrame("auth_failed", "device token rejected"),
    };
  }
  return { ok: true, principalRef: mobile.principalRef };
}
