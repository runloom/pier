import { beforeEach, describe, expect, it, vi } from "vitest";
import { createPluginFilesContext } from "@/lib/plugins/host-files-context.ts";

const request = {
  context: {
    contextId: "ctx:repo",
    projectRootPath: "/repo",
    updatedAt: 1,
  },
  suggestedName: "notes.md",
};

describe("plugin files save target facade", () => {
  const pickSaveTarget = vi.fn();

  beforeEach(() => {
    pickSaveTarget.mockReset();
    Object.defineProperty(window, "pier", {
      configurable: true,
      value: { files: { pickSaveTarget } },
    });
  });

  it("asserts file:write before forwarding to the preload facade", async () => {
    const target = {
      context: request.context,
      path: "notes.md",
      root: "/repo",
    };
    const assertCapability = vi.fn();
    pickSaveTarget.mockResolvedValue(target);
    const files = createPluginFilesContext(undefined, assertCapability);

    await expect(files.pickSaveTarget(request)).resolves.toEqual(target);
    expect(assertCapability).toHaveBeenCalledWith(undefined, "file:write");
    expect(pickSaveTarget).toHaveBeenCalledWith(request);
  });

  it("does not reach preload when the capability assertion rejects", () => {
    const assertCapability = vi.fn(() => {
      throw new Error("plugin capability not granted: file:write");
    });
    const files = createPluginFilesContext(undefined, assertCapability);

    expect(() => files.pickSaveTarget(request)).toThrow(/file:write/);
    expect(pickSaveTarget).not.toHaveBeenCalled();
  });
});
