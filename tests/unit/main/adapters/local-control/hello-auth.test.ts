import {
  type MobileAuthenticator,
  resolveHelloPrincipal,
} from "@main/adapters/cli/local-control/hello-auth.ts";
import { LOCAL_CONTROL_API_VERSION } from "@shared/contracts/local-control/errors.ts";
import type { LocalControlClientHello } from "@shared/contracts/local-control/frames.ts";
import { describe, expect, it, vi } from "vitest";

function cliHumanHello(): LocalControlClientHello {
  return {
    apiVersion: LOCAL_CONTROL_API_VERSION,
    type: "client.hello",
    requestId: "req-1",
    clientKind: "cli-human",
    auth: { method: "none" },
  };
}

function mobileHello(): LocalControlClientHello {
  return {
    apiVersion: LOCAL_CONTROL_API_VERSION,
    type: "client.hello",
    requestId: "req-1",
    clientKind: "mobile-paired",
    auth: {
      method: "device-token",
      deviceId: "dev-1",
      deviceToken: "tok-secret",
      shell: "web",
    },
  };
}

describe("resolveHelloPrincipal / cli-human 回归", () => {
  it("cli-human + auth.method none → human:peer", () => {
    expect(resolveHelloPrincipal(cliHumanHello())).toEqual({
      ok: true,
      principalRef: "human:peer",
    });
  });

  it("cli-human 携带 device-token → auth_failed", () => {
    const result = resolveHelloPrincipal({
      ...cliHumanHello(),
      auth: {
        method: "device-token",
        deviceId: "dev-1",
        deviceToken: "tok",
        shell: "web",
      },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errorFrame).toMatchObject({
        type: "server.error",
        code: "auth_failed",
      });
    }
  });
});

describe("resolveHelloPrincipal / mobile-paired", () => {
  it("无注入 authenticateMobile → auth_failed", () => {
    const result = resolveHelloPrincipal(mobileHello());
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errorFrame).toMatchObject({
        type: "server.error",
        code: "auth_failed",
      });
    }
  });

  it("注入认证通过 → 采用钩子返回的 principalRef，钩子收到完整设备凭证", () => {
    const authenticateMobile = vi.fn<MobileAuthenticator>(() => ({
      ok: true,
      principalRef: "mobile:dev-1",
    }));
    const result = resolveHelloPrincipal(mobileHello(), authenticateMobile);
    expect(result).toEqual({ ok: true, principalRef: "mobile:dev-1" });
    expect(authenticateMobile).toHaveBeenCalledWith({
      deviceId: "dev-1",
      deviceToken: "tok-secret",
      shell: "web",
    });
  });

  it("注入认证失败 → auth_failed", () => {
    const authenticateMobile: MobileAuthenticator = () => ({ ok: false });
    const result = resolveHelloPrincipal(mobileHello(), authenticateMobile);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errorFrame).toMatchObject({
        type: "server.error",
        code: "auth_failed",
      });
    }
  });

  it("mobile-paired 未持 device-token（auth.method none）→ auth_failed，不调用钩子", () => {
    const authenticateMobile = vi.fn<MobileAuthenticator>(() => ({
      ok: true,
      principalRef: "mobile:dev-1",
    }));
    const result = resolveHelloPrincipal(
      { ...mobileHello(), auth: { method: "none" } },
      authenticateMobile
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errorFrame).toMatchObject({
        type: "server.error",
        code: "auth_failed",
      });
    }
    expect(authenticateMobile).not.toHaveBeenCalled();
  });
});
