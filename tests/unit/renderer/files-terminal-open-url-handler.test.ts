import type { RendererPluginContext } from "@plugins/api/renderer.ts";
import type { PanelContext } from "@shared/contracts/panel.ts";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { handleFilesTerminalOpenUrl } from "../../../src/plugins/builtin/files/renderer/files-terminal-open-url-handler.ts";

function panelContext(partial: Partial<PanelContext> = {}): PanelContext {
  return {
    contextId: "c",
    cwd: "/repo/src",
    projectRootPath: "/repo",
    updatedAt: 1,
    ...partial,
  };
}

describe("handleFilesTerminalOpenUrl", () => {
  let openInstance: ReturnType<typeof vi.fn>;
  let openPath: ReturnType<typeof vi.fn>;
  let readDocument: ReturnType<typeof vi.fn>;
  let listInstances: ReturnType<typeof vi.fn>;
  let stat: ReturnType<typeof vi.fn>;
  let notificationsError: ReturnType<typeof vi.fn>;
  let getPanelContext: ReturnType<typeof vi.fn>;
  let context: RendererPluginContext;

  beforeEach(() => {
    openInstance = vi.fn();
    openPath = vi.fn(async () => ({ opened: true as const }));
    readDocument = vi.fn(async () => ({
      kind: "text",
      contents: "hi",
    }));
    stat = vi.fn(async () => ({
      exists: true,
      isDirectory: false,
      mtimeMs: 1,
      path: "README.md",
      root: "/repo",
      size: 2,
    }));
    notificationsError = vi.fn();
    getPanelContext = vi.fn(() => panelContext());
    listInstances = vi.fn(() => []);
    context = {
      files: {
        openPath,
        readDocument,
        stat,
      },
      i18n: {
        t: (_key: string, _values?: unknown, fallback?: string) =>
          fallback ?? _key,
      },
      notifications: {
        error: notificationsError,
      },
      panels: {
        openInstance,
        listInstances,
      },
      terminal: {
        getPanelContext,
      },
    } as unknown as RendererPluginContext;
  });

  it("ignores remote urls", async () => {
    await expect(
      handleFilesTerminalOpenUrl(context, {
        kind: "text",
        panelId: "t1",
        url: "https://example.com",
      })
    ).resolves.toBe(false);
    expect(openInstance).not.toHaveBeenCalled();
    expect(openPath).not.toHaveBeenCalled();
  });

  it("toasts when relative path has no cwd", async () => {
    getPanelContext.mockReturnValue(panelContext({ cwd: undefined }));
    await expect(
      handleFilesTerminalOpenUrl(context, {
        kind: "text",
        panelId: "t1",
        url: "docs/a.md",
      })
    ).resolves.toBe(true);
    expect(notificationsError).toHaveBeenCalled();
    expect(openPath).not.toHaveBeenCalled();
  });

  it("openPaths outside anchors", async () => {
    await expect(
      handleFilesTerminalOpenUrl(context, {
        kind: "text",
        panelId: "t1",
        url: "/tmp/outside.md",
      })
    ).resolves.toBe(true);
    expect(openPath).toHaveBeenCalledWith({ path: "/tmp/outside.md" });
    expect(openInstance).not.toHaveBeenCalled();
  });

  it("opens text files inside anchors via openInstance", async () => {
    await expect(
      handleFilesTerminalOpenUrl(context, {
        kind: "text",
        panelId: "t1",
        url: "/repo/README.md",
      })
    ).resolves.toBe(true);
    expect(openInstance).toHaveBeenCalledWith(
      expect.objectContaining({
        dropUnpinnedInstances: false,
        params: expect.objectContaining({
          pinned: true,
          source: {
            kind: "disk",
            path: "README.md",
            root: "/repo",
          },
        }),
        title: "README.md",
      })
    );
    expect(openPath).not.toHaveBeenCalled();
  });

  it("reuses an already-open same-source file tab", async () => {
    const existingId = "pier.files.filePanel:disk:abc:tab-1";
    listInstances.mockReturnValue([
      {
        groupId: "g1",
        id: existingId,
        params: {
          pinned: false,
          source: {
            kind: "disk",
            path: "README.md",
            root: "/repo",
          },
        },
      },
    ]);

    await expect(
      handleFilesTerminalOpenUrl(context, {
        kind: "text",
        panelId: "t1",
        url: "/repo/README.md",
      })
    ).resolves.toBe(true);

    expect(openInstance).toHaveBeenCalledTimes(1);
    expect(openInstance).toHaveBeenCalledWith(
      expect.objectContaining({
        dropUnpinnedInstances: false,
        instanceId: existingId,
        params: {
          pinned: false,
          source: {
            kind: "disk",
            path: "README.md",
            root: "/repo",
          },
        },
        title: "README.md",
      })
    );
    expect(openPath).not.toHaveBeenCalled();
  });

  it("falls back for binary documents", async () => {
    readDocument.mockResolvedValue({ kind: "binary", mime: null });
    await expect(
      handleFilesTerminalOpenUrl(context, {
        kind: "text",
        panelId: "t1",
        url: "/repo/a.zip",
      })
    ).resolves.toBe(true);
    expect(openPath).toHaveBeenCalledWith({ path: "/repo/a.zip" });
    expect(openInstance).not.toHaveBeenCalled();
  });

  it("logs why system open fallback is used", async () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => undefined);
    try {
      await expect(
        handleFilesTerminalOpenUrl(context, {
          kind: "text",
          panelId: "t1",
          url: "/tmp/outside.md",
        })
      ).resolves.toBe(true);
      expect(info).toHaveBeenCalledWith(
        "[files-terminal-open-url] system open fallback",
        expect.objectContaining({
          path: "/tmp/outside.md",
          reason: "outside-anchor",
        })
      );
      expect(openPath).toHaveBeenCalledWith({ path: "/tmp/outside.md" });
    } finally {
      info.mockRestore();
    }
  });
});
