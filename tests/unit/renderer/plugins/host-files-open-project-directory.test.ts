import { beforeEach, describe, expect, it, vi } from "vitest";
import { createPluginFilesContext } from "@/lib/plugins/host/files-context.ts";

vi.mock("@/lib/files/open-project-directory.ts", () => ({
  openProjectDirectory: vi.fn(async () => ({
    instanceId: "pier.files.filePanel:project:abc",
    ok: true,
    reused: false,
  })),
}));

describe("plugin files openProjectDirectory facade", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("asserts file:read and panel:open before opening", async () => {
    const { openProjectDirectory } = await import(
      "@/lib/files/open-project-directory.ts"
    );
    const assertCapability = vi.fn();
    const files = createPluginFilesContext(undefined, assertCapability);
    await expect(
      files.openProjectDirectory({ path: "", root: "/repo" })
    ).resolves.toMatchObject({ ok: true });
    expect(assertCapability).toHaveBeenNthCalledWith(1, undefined, "file:read");
    expect(assertCapability).toHaveBeenNthCalledWith(
      2,
      undefined,
      "panel:open"
    );
    expect(openProjectDirectory).toHaveBeenCalledWith({
      path: "",
      root: "/repo",
    });
  });

  it("does not open when file:read is rejected", async () => {
    const { openProjectDirectory } = await import(
      "@/lib/files/open-project-directory.ts"
    );
    const assertCapability = vi.fn((_: unknown, capability: string) => {
      if (capability === "file:read") {
        throw new Error("plugin capability not granted: file:read");
      }
    });
    const files = createPluginFilesContext(undefined, assertCapability);
    await expect(files.openProjectDirectory({ root: "/repo" })).rejects.toThrow(
      /file:read/
    );
    expect(openProjectDirectory).not.toHaveBeenCalled();
  });
});
