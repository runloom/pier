import { createUsageSourceRegistry } from "@main/services/usage-data/source-registry.ts";
import { describe, expect, it, vi } from "vitest";

describe("usage source registry", () => {
  it("registers a source and dispatches refreshAll to it", async () => {
    const registry = createUsageSourceRegistry();
    const rescan = vi.fn(() => Promise.resolve());
    const dispose = registry.register({ id: "pier.codex/local", rescan });
    expect(registry.list()).toHaveLength(1);
    await registry.refreshAll();
    expect(rescan).toHaveBeenCalledTimes(1);
    dispose();
    expect(registry.list()).toHaveLength(0);
    await registry.refreshAll();
    expect(rescan).toHaveBeenCalledTimes(1);
  });

  it("fan-outs refreshAll to every source in parallel", async () => {
    const registry = createUsageSourceRegistry();
    const rescanA = vi.fn(() => Promise.resolve());
    const rescanB = vi.fn(() => Promise.resolve());
    registry.register({ id: "a", rescan: rescanA });
    registry.register({ id: "b", rescan: rescanB });
    await registry.refreshAll();
    expect(rescanA).toHaveBeenCalledTimes(1);
    expect(rescanB).toHaveBeenCalledTimes(1);
  });

  it("does not short-circuit when a single source fails and throws the first error", async () => {
    const registry = createUsageSourceRegistry();
    const rescanA = vi.fn(() => Promise.reject(new Error("source a boom")));
    const rescanB = vi.fn(() => Promise.resolve());
    registry.register({ id: "a", rescan: rescanA });
    registry.register({ id: "b", rescan: rescanB });
    await expect(registry.refreshAll()).rejects.toThrow("source a boom");
    expect(rescanA).toHaveBeenCalledTimes(1);
    expect(rescanB).toHaveBeenCalledTimes(1);
  });

  it("ignores duplicate id registrations to protect the primary registration", async () => {
    const registry = createUsageSourceRegistry();
    const first = vi.fn(() => Promise.resolve());
    const shadow = vi.fn(() => Promise.resolve());
    registry.register({ id: "codex/local", rescan: first });
    registry.register({ id: "codex/local", rescan: shadow });
    await registry.refreshAll();
    expect(first).toHaveBeenCalledTimes(1);
    expect(shadow).not.toHaveBeenCalled();
  });
});
