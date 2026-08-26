import { beforeEach, describe, expect, it, vi } from "vitest";
import { createPluginProjectMemoryContext } from "@/lib/plugins/host/project-memory-context.ts";

const root = { projectRootPath: "/p", scope: "project" as const };

describe("plugin projectMemory facade", () => {
  const api = {
    disable: vi.fn(),
    enable: vi.fn(),
    status: vi.fn(),
  };

  beforeEach(() => {
    api.disable.mockReset();
    api.enable.mockReset();
    api.status.mockReset();
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
    expect(api.enable).toHaveBeenCalledWith(root, undefined);
  });

  it("does not reach preload when the capability assertion rejects", () => {
    const assert = vi.fn(() => {
      throw new Error("missing capability: managedAssets:write");
    });
    const ctx = createPluginProjectMemoryContext(undefined, assert);
    expect(() => ctx.enable(root)).toThrow(/managedAssets:write/);
    expect(api.enable).not.toHaveBeenCalled();
  });
});
