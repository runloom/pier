// @vitest-environment jsdom
import { cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { host, useHostSnapshot } from "@/lib/live-modules/host.ts";
import * as resourceStore from "@/stores/pier-resource.store.ts";

describe("canvas host runtime", () => {
  const originalPier = window.pier;

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    window.pier = originalPier;
  });

  it("denies writes before IPC", async () => {
    await expect(
      host.invoke({
        contents: "x",
        path: "notes.md",
        root: "/tmp",
        type: "file.writeText",
      })
    ).rejects.toThrow(/canvas host denies file.writeText/);
  });

  it("inspects the allowlist without a preload bridge", () => {
    const inspected = host.inspect();
    expect(inspected.commands).toContain("file.list");
    expect(inspected.channels).toContain("pier://git:changed");
    expect(inspected.snapshots).toEqual([
      "foreground-activity",
      "resources",
      "usage-data",
    ]);
    const file = inspected.domains.find((domain) => domain.id === "file");
    const list = file?.commands.find((command) => command.type === "file.list");
    expect(list?.fields.map((field) => field.name).sort()).toEqual([
      "path",
      "root",
    ]);
    expect(list?.fields.every((field) => field.optional === false)).toBe(true);
    expect(file?.exemplar).toBe("file.list");
  });

  it("returns an empty ready snapshot when the host bridge is missing", () => {
    const { result } = renderHook(() => useHostSnapshot("foreground-activity"));
    expect(result.current).toEqual({
      data: null,
      error: null,
      status: "ready",
    });
  });

  it("loads a snapshot id and subscribes to its live channel", () => {
    const snapshot = vi.fn(async () => ({ activities: [], ts: 1 }));
    const unsubscribe = vi.fn();
    const subscribe = vi.fn(() => unsubscribe);
    window.pier = {
      canvasHost: {
        inspect: host.inspect,
        invoke: vi.fn(),
        snapshot,
        subscribe,
      },
    } as unknown as typeof window.pier;
    const { unmount } = renderHook(() =>
      useHostSnapshot("foreground-activity")
    );
    expect(snapshot).toHaveBeenCalledWith("foreground-activity");
    expect(subscribe).toHaveBeenCalledWith(
      "pier://foreground-activity:changed",
      expect.any(Function)
    );
    unmount();
    expect(unsubscribe).toHaveBeenCalledTimes(1);
  });

  it("starts and stops resource polling while the snapshot hook is mounted", () => {
    const release = vi.fn();
    const acquire = vi
      .spyOn(resourceStore, "acquirePierResourcePolling")
      .mockReturnValue(release);
    const { unmount } = renderHook(() => useHostSnapshot("resources"));
    expect(acquire).toHaveBeenCalledTimes(1);
    unmount();
    expect(release).toHaveBeenCalledTimes(1);
  });
});
