import { beforeEach, describe, expect, it, vi } from "vitest";
import { createPluginProjectMemoryContext } from "@/lib/plugins/host/project-memory-context.ts";

const root = { projectRootPath: "/p", scope: "project" as const };

describe("plugin projectMemory facade", () => {
  const api = {
    clearStore: vi.fn(),
    deleteObservation: vi.fn(),
    disable: vi.fn(),
    enable: vi.fn(),
    list: vi.fn(),
    status: vi.fn(),
  };

  beforeEach(() => {
    api.disable.mockReset();
    api.enable.mockReset();
    api.status.mockReset();
    api.clearStore.mockReset();
    api.deleteObservation.mockReset();
    api.list.mockReset();
    Object.defineProperty(window, "pier", {
      configurable: true,
      value: { memory: api },
    });
  });

  it("asserts managedAssets:write and forwards enable", async () => {
    const assert = vi.fn();
    api.enable.mockResolvedValue({
      kind: "report",
      state: "enabled",
      targets: [],
    });
    const ctx = createPluginProjectMemoryContext(undefined, assert);
    await ctx.enable(root);
    expect(assert).toHaveBeenCalledWith(undefined, "managedAssets:write");
    expect(api.enable).toHaveBeenCalledWith(root);
  });

  it("does not reach preload when the capability assertion rejects", () => {
    const assert = vi.fn(() => {
      throw new Error("missing capability: managedAssets:write");
    });
    const ctx = createPluginProjectMemoryContext(undefined, assert);
    expect(() => ctx.enable(root)).toThrow(/managedAssets:write/);
    expect(api.enable).not.toHaveBeenCalled();
  });

  it("forwards list delete and clear", async () => {
    const assert = vi.fn();
    api.list.mockResolvedValue({ items: [], tooLarge: false });
    api.deleteObservation.mockResolvedValue(undefined);
    api.clearStore.mockResolvedValue(undefined);
    const ctx = createPluginProjectMemoryContext(undefined, assert);
    await ctx.list(root);
    await ctx.deleteObservation(root, "pnpm", 0, "use pnpm");
    await ctx.clearStore(root);
    expect(api.list).toHaveBeenCalledWith(root);
    expect(api.deleteObservation).toHaveBeenCalledWith(
      root,
      "pnpm",
      0,
      "use pnpm"
    );
    expect(api.clearStore).toHaveBeenCalledWith(root);
  });
});
