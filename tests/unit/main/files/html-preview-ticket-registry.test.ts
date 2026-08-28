import { createHtmlPreviewTicketRegistry } from "@main/files/html-preview-ticket-registry.ts";
import { describe, expect, it } from "vitest";

const ownerA = { partition: "persist:pier", webContentsId: 10 };
const ownerB = { partition: "persist:pier", webContentsId: 11 };

function setup(
  options: {
    maxEntries?: number;
    maxEntriesPerOwner?: number;
    ttlMs?: number;
  } = {}
) {
  let now = 100;
  let sequence = 0;
  const registry = createHtmlPreviewTicketRegistry({
    now: () => now,
    randomToken: () => `${++sequence}`.padStart(32, "0"),
    ...options,
  });
  return {
    advance: (ms: number) => {
      now += ms;
    },
    registry,
  };
}

describe("html preview ticket registry", () => {
  it("binds authorization to the owning partition and webContents", () => {
    const { registry } = setup();
    const issued = registry.issue({ owner: ownerA, rootRealpath: "/repo" });

    expect(issued.ticket).toMatch(/^[A-Za-z0-9_-]{22,128}$/u);
    expect(registry.peek(issued.ticket)).toBe("/repo");
    expect(registry.authorize(issued.ticket, ownerA)).toBe("/repo");
    expect(
      registry.authorize(issued.ticket, { ...ownerA, webContentsId: 99 })
    ).toBeNull();
    expect(
      registry.authorize(issued.ticket, { ...ownerA, partition: "other" })
    ).toBeNull();
  });

  it("revokes the previous ticket of the same owner on rotation", () => {
    const { registry } = setup();
    const first = registry.issue({ owner: ownerA, rootRealpath: "/repo" });
    const rotated = registry.issue({
      owner: ownerA,
      previousTicket: first.ticket,
      rootRealpath: "/repo",
    });

    expect(registry.authorize(first.ticket, ownerA)).toBeNull();
    expect(registry.authorize(rotated.ticket, ownerA)).toBe("/repo");
  });

  it("never revokes a previous ticket owned by another owner", () => {
    const { registry } = setup();
    const foreign = registry.issue({ owner: ownerB, rootRealpath: "/repo" });
    registry.issue({
      owner: ownerA,
      previousTicket: foreign.ticket,
      rootRealpath: "/repo",
    });

    expect(registry.authorize(foreign.ticket, ownerB)).toBe("/repo");
  });

  it("expires tickets after the TTL", () => {
    const { advance, registry } = setup({ ttlMs: 50 });
    const issued = registry.issue({ owner: ownerA, rootRealpath: "/repo" });

    advance(51);

    expect(registry.authorize(issued.ticket, ownerA)).toBeNull();
    expect(registry.peek(issued.ticket)).toBeNull();
  });

  it("revokes every ticket of a destroyed webContents", () => {
    const { registry } = setup();
    const first = registry.issue({ owner: ownerA, rootRealpath: "/repo" });
    const second = registry.issue({ owner: ownerB, rootRealpath: "/repo" });

    registry.revokeWebContents(ownerA.webContentsId);

    expect(registry.authorize(first.ticket, ownerA)).toBeNull();
    expect(registry.authorize(second.ticket, ownerB)).toBe("/repo");
  });

  it("evicts least-recently-used tickets per owner without crossing owners", () => {
    const { registry } = setup({ maxEntriesPerOwner: 2 });
    const other = registry.issue({ owner: ownerB, rootRealpath: "/repo" });
    const first = registry.issue({ owner: ownerA, rootRealpath: "/repo" });
    const second = registry.issue({ owner: ownerA, rootRealpath: "/repo" });
    expect(registry.authorize(first.ticket, ownerA)).toBe("/repo");
    const third = registry.issue({ owner: ownerA, rootRealpath: "/repo" });

    expect(registry.authorize(first.ticket, ownerA)).toBe("/repo");
    expect(registry.authorize(second.ticket, ownerA)).toBeNull();
    expect(registry.authorize(third.ticket, ownerA)).toBe("/repo");
    expect(registry.authorize(other.ticket, ownerB)).toBe("/repo");
  });

  it("enforces the global LRU limit and explicit release", () => {
    const { registry } = setup({ maxEntries: 2, maxEntriesPerOwner: 2 });
    const first = registry.issue({ owner: ownerA, rootRealpath: "/repo" });
    const second = registry.issue({ owner: ownerB, rootRealpath: "/repo" });
    registry.authorize(first.ticket, ownerA);
    const third = registry.issue({ owner: ownerB, rootRealpath: "/repo" });

    expect(registry.authorize(first.ticket, ownerA)).toBe("/repo");
    expect(registry.authorize(second.ticket, ownerB)).toBeNull();
    expect(registry.release(third.ticket)).toBe(true);
    expect(registry.authorize(third.ticket, ownerB)).toBeNull();
  });

  it("slides expiry on authorize so an active ticket outlives one TTL window", () => {
    const { advance, registry } = setup({ ttlMs: 50 });
    const issued = registry.issue({ owner: ownerA, rootRealpath: "/repo" });

    advance(40);
    expect(registry.authorize(issued.ticket, ownerA)).toBe("/repo");
    advance(40);
    expect(registry.authorize(issued.ticket, ownerA)).toBe("/repo");
  });

  it("still expires when idle past the TTL", () => {
    const { advance, registry } = setup({ ttlMs: 50 });
    const issued = registry.issue({ owner: ownerA, rootRealpath: "/repo" });
    advance(51);
    expect(registry.peek(issued.ticket)).toBeNull();
    expect(registry.authorize(issued.ticket, ownerA)).toBeNull();
  });

  it("touches a live ticket and rejects foreign or expired tickets", () => {
    const { advance, registry } = setup({ ttlMs: 50 });
    const issued = registry.issue({ owner: ownerA, rootRealpath: "/repo" });

    expect(registry.touch(issued.ticket, ownerB)).toBe(false);
    expect(registry.touch(issued.ticket, ownerA)).toBe(true);
    advance(40);
    expect(registry.touch(issued.ticket, ownerA)).toBe(true);
    advance(40);
    expect(registry.authorize(issued.ticket, ownerA)).toBe("/repo");

    const idle = registry.issue({ owner: ownerA, rootRealpath: "/repo" });
    advance(51);
    expect(registry.touch(idle.ticket, ownerA)).toBe(false);
  });
});
