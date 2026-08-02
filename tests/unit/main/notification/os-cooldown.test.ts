import {
  createOsCooldownStore,
  extractAgentRefFromCooldownKey,
} from "@main/services/notification-center/os-cooldown.ts";
import { describe, expect, it } from "vitest";

describe("createOsCooldownStore", () => {
  it("tryReserve blocks concurrent in-flight for same key", () => {
    const store = createOsCooldownStore();
    expect(store.tryReserve("k", 180_000, 1000)).toBe(true);
    expect(store.tryReserve("k", 180_000, 1001)).toBe(false);
    store.release("k");
    expect(store.tryReserve("k", 180_000, 1002)).toBe(true);
  });

  it("commit enforces cooldown after shown", () => {
    const store = createOsCooldownStore();
    expect(store.tryReserve("k", 180_000, 1000)).toBe(true);
    store.commit("k", 1000);
    expect(store.tryReserve("k", 180_000, 50_000)).toBe(false);
    expect(store.tryReserve("k", 180_000, 200_000)).toBe(true);
  });

  it("release after failed show allows immediate retry", () => {
    const store = createOsCooldownStore();
    expect(store.tryReserve("k", 180_000, 1000)).toBe(true);
    store.release("k");
    expect(store.tryReserve("k", 180_000, 1001)).toBe(true);
  });

  it("cooldownMs 0 still serializes in-flight but not success gap", () => {
    const store = createOsCooldownStore();
    expect(store.tryReserve("k", 0, 1000)).toBe(true);
    expect(store.tryReserve("k", 0, 1001)).toBe(false);
    store.commit("k", 1000);
    expect(store.tryReserve("k", 0, 1002)).toBe(true);
  });

  it("prune drops dead agentRefs from lastShown and inFlight", () => {
    const store = createOsCooldownStore();
    const live = "11\0p1";
    const dead = "22\0p2";
    const liveKey = `agent.attention:waiting:${live}`;
    const deadKey = `agent.attention:waiting:${dead}`;
    store.mark(liveKey, 1);
    store.mark(deadKey, 1);
    expect(store.tryReserve(deadKey, 180_000, 2)).toBe(false);
    // put dead in-flight then prune
    store.release(deadKey);
    expect(store.tryReserve(deadKey, 0, 3)).toBe(true);
    store.prune(new Set([live]));
    expect(store.tryReserve(deadKey, 180_000, 4)).toBe(true);
    expect(store.tryReserve(liveKey, 180_000, 4)).toBe(false);
  });
});

describe("extractAgentRefFromCooldownKey", () => {
  it("parses known prefixes", () => {
    expect(extractAgentRefFromCooldownKey("agent.attention:waiting:a\0b")).toBe(
      "a\0b"
    );
    expect(extractAgentRefFromCooldownKey("agent.attention:error:a\0b")).toBe(
      "a\0b"
    );
    expect(extractAgentRefFromCooldownKey("agent.turn-finished:x")).toBe("x");
    expect(extractAgentRefFromCooldownKey("app.update:global")).toBeNull();
  });
});
