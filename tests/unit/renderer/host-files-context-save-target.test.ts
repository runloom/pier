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

describe("plugin files queryPaths facade", () => {
  const start = vi.fn();
  const cancel = vi.fn();
  const onEvent = vi.fn(() => () => undefined);

  beforeEach(() => {
    start.mockReset();
    cancel.mockReset();
    onEvent.mockReset();
    onEvent.mockReturnValue(() => undefined);
    Object.defineProperty(window, "pier", {
      configurable: true,
      value: {
        fileQuery: {
          cancel,
          onEvent,
          start,
        },
      },
    });
  });

  it("exposes started from fileQuery.start and does not swallow false", async () => {
    start.mockResolvedValue(false);
    const assertCapability = vi.fn();
    const files = createPluginFilesContext(undefined, assertCapability);

    const handle = files.queryPaths({
      owner: "quick-open:s1",
      query: "theme",
      root: "/repo",
    });

    expect(assertCapability).toHaveBeenCalledWith(undefined, "file:read");
    await expect(handle.started).resolves.toBe(false);
    expect(start).toHaveBeenCalledWith(
      expect.objectContaining({
        owner: "quick-open:s1",
        query: "theme",
        queryId: handle.queryId,
        root: "/repo",
      })
    );
  });

  it("forwards start rejection through started", async () => {
    start.mockRejectedValue(new Error("main unavailable"));
    const files = createPluginFilesContext(undefined, vi.fn());

    const handle = files.queryPaths({
      owner: "tree-search:t1",
      query: "",
      root: "/repo",
    });

    await expect(handle.started).rejects.toThrow("main unavailable");
  });
});
