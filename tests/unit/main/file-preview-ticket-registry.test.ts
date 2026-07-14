import { createFilePreviewTicketRegistry } from "@main/files/file-preview-ticket-registry.ts";
import { filePreviewTicketFromUrl } from "@shared/file-preview-url.ts";
import { describe, expect, it } from "vitest";

const ownerA = {
  partition: "persist:pier",
  recordId: "a",
  runtimeId: "ra",
  webContentsId: 10,
};
const ownerB = {
  partition: "persist:pier",
  recordId: "b",
  runtimeId: "rb",
  webContentsId: 11,
};
const locator = (path = "images/logo.png") => ({
  root: "/repo",
  path,
  revision: "file-v1:test",
  mime: "image/png",
});

function setup(
  options: {
    maxEntries?: number;
    maxEntriesPerOwner?: number;
    ttlMs?: number;
  } = {}
) {
  let now = 100;
  let sequence = 0;
  const registry = createFilePreviewTicketRegistry({
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

describe("file preview ticket registry", () => {
  it("issues opaque URLs and binds lookup to the owning partition and webContents", () => {
    const { registry } = setup();
    const issued = registry.issue({ locator: locator(), owner: ownerA });

    expect(issued.url).toBe(
      "pier-file-preview://file/00000000000000000000000000000001"
    );
    expect(issued.url).not.toContain("repo");
    expect(filePreviewTicketFromUrl(issued.url)).toBe(issued.ticket);
    expect(registry.resolve(issued.ticket, ownerA)?.locator).toEqual(locator());
    expect(
      registry.resolve(issued.ticket, { ...ownerA, webContentsId: 99 })
    ).toBeNull();
    expect(
      registry.resolve(issued.ticket, { ...ownerA, partition: "other" })
    ).toBeNull();
  });

  it("expires tickets and revokes all tickets for a runtime", () => {
    const { advance, registry } = setup({ ttlMs: 50 });
    const first = registry.issue({ locator: locator("a.png"), owner: ownerA });
    const second = registry.issue({ locator: locator("b.png"), owner: ownerA });
    advance(51);
    expect(registry.resolve(first.ticket, ownerA)).toBeNull();
    const fresh = registry.issue({ locator: locator("c.png"), owner: ownerA });
    registry.revokeRuntime(ownerA.runtimeId);
    expect(registry.resolve(second.ticket, ownerA)).toBeNull();
    expect(registry.resolve(fresh.ticket, ownerA)).toBeNull();
  });

  it("evicts least-recently-used tickets per owner without crossing owners", () => {
    const { registry } = setup({ maxEntriesPerOwner: 2 });
    const other = registry.issue({
      locator: locator("other.png"),
      owner: ownerB,
    });
    const first = registry.issue({
      locator: locator("first.png"),
      owner: ownerA,
    });
    const second = registry.issue({
      locator: locator("second.png"),
      owner: ownerA,
    });
    expect(registry.resolve(first.ticket, ownerA)).not.toBeNull();
    const third = registry.issue({
      locator: locator("third.png"),
      owner: ownerA,
    });

    expect(registry.resolve(first.ticket, ownerA)).not.toBeNull();
    expect(registry.resolve(second.ticket, ownerA)).toBeNull();
    expect(registry.resolve(third.ticket, ownerA)).not.toBeNull();
    expect(registry.resolve(other.ticket, ownerB)).not.toBeNull();
  });

  it("enforces the global LRU limit and explicit release", () => {
    const { registry } = setup({ maxEntries: 2, maxEntriesPerOwner: 2 });
    const first = registry.issue({
      locator: locator("first.png"),
      owner: ownerA,
    });
    const second = registry.issue({
      locator: locator("second.png"),
      owner: ownerB,
    });
    registry.resolve(first.ticket, ownerA);
    const third = registry.issue({
      locator: locator("third.png"),
      owner: ownerB,
    });

    expect(registry.resolve(first.ticket, ownerA)).not.toBeNull();
    expect(registry.resolve(second.ticket, ownerB)).toBeNull();
    expect(registry.release(third.ticket)).toBe(true);
    expect(registry.resolve(third.ticket, ownerB)).toBeNull();
  });
});
