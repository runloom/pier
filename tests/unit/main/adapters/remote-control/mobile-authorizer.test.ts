import {
  createMobileAuthorizer,
  MOBILE_ALLOWED,
} from "@main/adapters/remote-control/mobile-authorizer.ts";
import { describe, expect, it, vi } from "vitest";

describe("createMobileAuthorizer", () => {
  it("白名单内全部 op 放行", () => {
    const authorizer = createMobileAuthorizer(() => true);
    for (const op of MOBILE_ALLOWED) {
      expect(
        authorizer.authorize({
          op,
          params: {},
          principalKind: "mobile-paired",
          principalRef: "mobile:dev-1",
        })
      ).toEqual({ ok: true });
    }
  });

  it.each([
    "agents.start",
    "control.hold",
    "control.trace",
    "agents.self",
  ])("白名单外 op %s → permission_denied", (op) => {
    const authorizer = createMobileAuthorizer(() => true);
    const result = authorizer.authorize({
      op,
      params: {},
      principalKind: "mobile-paired",
      principalRef: "mobile:dev-1",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("permission_denied");
    }
  });

  it("epoch 门关闭（assertLive false）→ 白名单内 op 也拒绝为 device_revoked", () => {
    const authorizer = createMobileAuthorizer(() => false);
    const result = authorizer.authorize({
      op: "agents.list",
      params: {},
      principalKind: "mobile-paired",
      principalRef: "mobile:dev-1",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("device_revoked");
    }
  });

  it("epoch 门先于白名单判定，且每次 authorize 都重新核对", () => {
    const assertLive = vi.fn(() => true);
    const authorizer = createMobileAuthorizer(assertLive);
    authorizer.authorize({
      op: "control.snapshot",
      params: {},
      principalKind: "mobile-paired",
    });
    authorizer.authorize({
      op: "agents.start",
      params: {},
      principalKind: "mobile-paired",
    });
    expect(assertLive).toHaveBeenCalledTimes(2);
  });
});
