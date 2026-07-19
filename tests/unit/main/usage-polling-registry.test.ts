import { describe, expect, it } from "vitest";
import {
  createUsagePollingRegistry,
  USAGE_POLLING_LEASE_TTL_MS,
} from "../../../packages/plugin-api/src/account-usage/usage-polling-registry.ts";

describe("createUsagePollingRegistry", () => {
  it("reports firstConsumer only when no live consumers exist", () => {
    const registry = createUsagePollingRegistry(() => 1000);
    expect(registry.acquire("settings#a")).toEqual({ firstConsumer: true });
    expect(registry.acquire("widget#b")).toEqual({ firstConsumer: false });
    // Renewing an existing lease is not a first consumer either.
    expect(registry.acquire("settings#a")).toEqual({ firstConsumer: false });
  });

  it("keeps polling alive for the remaining window when one releases", () => {
    const registry = createUsagePollingRegistry(() => 1000);
    registry.acquire("settings#windowA");
    registry.acquire("settings#windowB");
    registry.release("settings#windowA");
    // Unique per-mount ids: window B's lease survives window A's release.
    expect(registry.hasVisibleTarget()).toBe(true);
    registry.release("settings#windowB");
    expect(registry.hasVisibleTarget()).toBe(false);
  });

  it("expires leases that miss their heartbeats (reloaded/crashed window)", () => {
    let now = 0;
    const registry = createUsagePollingRegistry(() => now);
    registry.acquire("settings#gone");
    now = USAGE_POLLING_LEASE_TTL_MS + 1;
    expect(registry.hasVisibleTarget()).toBe(false);
  });

  it("heartbeat renewal keeps a lease alive past the TTL", () => {
    let now = 0;
    const registry = createUsagePollingRegistry(() => now);
    registry.acquire("widget#alive");
    now = USAGE_POLLING_LEASE_TTL_MS - 1;
    registry.acquire("widget#alive");
    now += USAGE_POLLING_LEASE_TTL_MS - 1;
    expect(registry.hasVisibleTarget()).toBe(true);
  });

  it("re-acquire after expiry counts as a first consumer again", () => {
    let now = 0;
    const registry = createUsagePollingRegistry(() => now);
    registry.acquire("settings#a");
    now = USAGE_POLLING_LEASE_TTL_MS + 1;
    expect(registry.acquire("settings#a")).toEqual({ firstConsumer: true });
  });

  it("clear drops every lease", () => {
    const registry = createUsagePollingRegistry(() => 0);
    registry.acquire("a");
    registry.acquire("b");
    registry.clear();
    expect(registry.hasVisibleTarget()).toBe(false);
  });
});
