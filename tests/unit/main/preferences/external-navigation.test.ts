import { createExternalNavigationService } from "@main/services/external-navigation.ts";
import type { ExternalNavigationRequest } from "@shared/contracts/external-navigation.ts";
import { describe, expect, it, vi } from "vitest";

const NOW = 1_000_000;

function request(
  url: string,
  overrides: Partial<ExternalNavigationRequest> = {}
): ExternalNavigationRequest {
  return {
    issuedAt: NOW,
    nonce: "0123456789abcdef0123456789abcdef",
    url,
    ...overrides,
  };
}

describe("external navigation service", () => {
  it.each([
    "http://example.com",
    "mailto:user@example.com",
    "https://user:password@example.com",
    "https://example.com\\redirect",
    "https://example.com/\u0000control",
    `https://example.com/${"a".repeat(2049)}`,
    "https://example.com/a\u0085b",
    `https://example.com/${"界".repeat(300)}`,
  ])("rejects an unsafe external URL without invoking the shell: %s", async (url) => {
    const openExternal = vi.fn(async () => undefined);
    const service = createExternalNavigationService({
      now: () => NOW,
      openExternal,
    });

    await expect(service.open(request(url))).resolves.toEqual({
      opened: false,
      reason: "invalid-url",
    });
    expect(openExternal).not.toHaveBeenCalled();
  });

  it("opens one normalized HTTPS URL exactly once", async () => {
    const openExternal = vi.fn(async () => undefined);
    const service = createExternalNavigationService({
      now: () => NOW,
      openExternal,
    });
    const payload = request("https://example.com/docs?q=1#intro");

    await expect(service.open(payload)).resolves.toEqual({ opened: true });
    await expect(service.open(payload)).resolves.toEqual({
      opened: false,
      reason: "replayed",
    });
    expect(openExternal).toHaveBeenCalledOnce();
    expect(openExternal).toHaveBeenCalledWith(
      "https://example.com/docs?q=1#intro"
    );
  });

  it("rejects an expired activation before invoking the shell", async () => {
    const openExternal = vi.fn(async () => undefined);
    const service = createExternalNavigationService({
      now: () => NOW,
      openExternal,
    });

    await expect(
      service.open(request("https://example.com", { issuedAt: NOW - 1001 }))
    ).resolves.toEqual({ opened: false, reason: "expired" });
    expect(openExternal).not.toHaveBeenCalled();
  });

  it("returns a typed failure when the operating system rejects the URL", async () => {
    const service = createExternalNavigationService({
      now: () => NOW,
      openExternal: vi.fn(async () => {
        throw new Error("no browser");
      }),
    });

    await expect(service.open(request("https://example.com"))).resolves.toEqual(
      { opened: false, reason: "open-failed" }
    );
  });
});
