import { createExternalNavigationApi } from "@preload/external-navigation-api.ts";
import { describe, expect, it, vi } from "vitest";

function setup(options: { active?: boolean } = {}) {
  const invoke = vi.fn(async () => ({ opened: true as const }));
  const api = createExternalNavigationApi({
    invoke,
    isUserActivationActive: () => options.active ?? true,
    now: () => 123,
    randomNonce: () => "0123456789abcdef0123456789abcdef",
  });
  return { api, invoke };
}

describe("external navigation preload API", () => {
  it("requires an active user gesture without invoking main", async () => {
    const { api, invoke } = setup({ active: false });

    await expect(api.open("https://example.com")).resolves.toEqual({
      opened: false,
      reason: "user-activation-required",
    });
    expect(invoke).not.toHaveBeenCalled();
  });

  it("adds a private nonce and activation time", async () => {
    const { api, invoke } = setup();

    await expect(api.open("https://example.com/docs")).resolves.toEqual({
      opened: true,
    });
    expect(invoke).toHaveBeenCalledWith({
      issuedAt: 123,
      nonce: "0123456789abcdef0123456789abcdef",
      url: "https://example.com/docs",
    });
  });

  it("allows only one in-flight request", async () => {
    let resolveFirst: ((value: { opened: true }) => void) | undefined;
    const invoke = vi.fn(
      () =>
        new Promise<{ opened: true }>((resolve) => {
          resolveFirst = resolve;
        })
    );
    const api = createExternalNavigationApi({
      invoke,
      isUserActivationActive: () => true,
      now: () => 123,
      randomNonce: () => "0123456789abcdef0123456789abcdef",
    });

    const first = api.open("https://example.com/first");
    await expect(api.open("https://example.com/second")).resolves.toEqual({
      opened: false,
      reason: "busy",
    });
    resolveFirst?.({ opened: true });
    await expect(first).resolves.toEqual({ opened: true });
    expect(invoke).toHaveBeenCalledOnce();
  });

  it("returns a typed failure when IPC rejects", async () => {
    const api = createExternalNavigationApi({
      invoke: vi.fn(async () => {
        throw new Error("ipc gone");
      }),
      isUserActivationActive: () => true,
      now: () => 123,
      randomNonce: () => "0123456789abcdef0123456789abcdef",
    });

    await expect(api.open("https://example.com")).resolves.toEqual({
      opened: false,
      reason: "open-failed",
    });
  });
});
