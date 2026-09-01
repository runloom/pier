// @vitest-environment jsdom
/**
 * PWA 叫醒订阅（M2 Task 10）：standalone 门控、权限拒绝短路、句柄编码。
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import {
  canSubscribe,
  isStandalone,
  subscribeWebPush,
} from "../../../apps/mobile-web/src/lib/push.ts";

const originalMatchMedia = window.matchMedia;

afterEach(() => {
  window.matchMedia = originalMatchMedia;
  vi.unstubAllGlobals();
});

function stubStandalone(standalone: boolean): void {
  window.matchMedia = ((query: string) => ({
    matches: standalone && query.includes("standalone"),
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    media: query,
    onchange: null,
    addListener: () => undefined,
    removeListener: () => undefined,
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
}

describe("standalone 门控", () => {
  it("非 standalone → isStandalone/canSubscribe 均 false", () => {
    stubStandalone(false);
    expect(isStandalone()).toBe(false);
    expect(canSubscribe()).toBe(false);
  });

  it("standalone 但缺 PushManager → canSubscribe false（iOS 未装到主屏前）", () => {
    stubStandalone(true);
    // jsdom 无 PushManager：canSubscribe 依赖其存在。
    expect(canSubscribe()).toBe(false);
  });
});

describe("subscribeWebPush", () => {
  it("不满足订阅条件 → 直接返回 null（不触发权限弹窗）", async () => {
    stubStandalone(false);
    const requestPermission = vi.fn();
    vi.stubGlobal("Notification", { requestPermission });
    const result = await subscribeWebPush("cHVibGljLWtleQ");
    expect(result).toBeNull();
    expect(requestPermission).not.toHaveBeenCalled();
  });

  it("权限被拒 → 返回 null（standalone + PushManager 齐备时）", async () => {
    stubStandalone(true);
    vi.stubGlobal("PushManager", class {});
    vi.stubGlobal("Notification", {
      requestPermission: vi.fn(async () => "denied"),
    });
    const registration = {
      pushManager: { subscribe: vi.fn() },
    } as unknown as ServiceWorkerRegistration;
    const result = await subscribeWebPush("cHVibGljLWtleQ", registration);
    expect(result).toBeNull();
    expect(registration.pushManager.subscribe).not.toHaveBeenCalled();
  });

  it("授权后订阅 → 返回 endpoint + keys 句柄", async () => {
    stubStandalone(true);
    vi.stubGlobal("PushManager", class {});
    vi.stubGlobal("Notification", {
      requestPermission: vi.fn(async () => "granted"),
    });
    const subscribe = vi.fn(async () => ({
      endpoint: "https://web.push.apple.com/sub/1",
      getKey: () => null,
      toJSON: () => ({
        endpoint: "https://web.push.apple.com/sub/1",
        keys: { auth: "auth-secret", p256dh: "p256dh-key" },
      }),
    }));
    const registration = {
      pushManager: { subscribe },
    } as unknown as ServiceWorkerRegistration;
    const result = await subscribeWebPush("cHVibGljLWtleQ", registration);
    expect(result).toEqual({
      endpoint: "https://web.push.apple.com/sub/1",
      keys: { auth: "auth-secret", p256dh: "p256dh-key" },
    });
    expect(subscribe).toHaveBeenCalledWith(
      expect.objectContaining({ userVisibleOnly: true })
    );
  });
});
