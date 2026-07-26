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
        listInstancesGlobal: vi.fn(async () => []),
        focusInstance: vi.fn(async () => ({ kind: "focused" as const })),
        getActiveInstanceId: vi.fn(() => null),
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

  it("toasts when relative path has no resolve roots", async () => {
    getPanelContext.mockReturnValue(null);
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

  it("falls back from cwd to project root when only project has the file", async () => {
    getPanelContext.mockReturnValue(
      panelContext({
        cwd: "/repo/src",
        projectRootPath: "/repo",
        worktreeRoot: "/repo",
      })
    );
    stat.mockImplementation(async (request: { path: string; root: string }) => {
      const exists = request.root === "/repo" && request.path === "docs/a.md";
      return {
        exists,
        isDirectory: false,
        mtimeMs: 1,
        path: request.path,
        root: request.root,
        size: 2,
      };
    });

    await expect(
      handleFilesTerminalOpenUrl(context, {
        kind: "text",
        panelId: "t1",
        url: "docs/a.md",
      })
    ).resolves.toBe(true);

    // First candidate is under cwd (/repo/src/docs/a.md) and is missing.
    expect(stat).toHaveBeenCalledWith({
      path: "docs/a.md",
      root: "/repo/src",
    });
    // Second candidate is under worktree/project root and exists.
    expect(stat).toHaveBeenCalledWith({
      path: "docs/a.md",
      root: "/repo",
    });
    expect(openInstance).toHaveBeenCalledWith(
      expect.objectContaining({
        params: expect.objectContaining({
          source: {
            kind: "disk",
            path: "docs/a.md",
            root: "/repo",
          },
        }),
      })
    );
  });

  it("opens relative path against project root when cwd is missing", async () => {
    getPanelContext.mockReturnValue(
      panelContext({ cwd: undefined, projectRootPath: "/repo" })
    );
    await expect(
      handleFilesTerminalOpenUrl(context, {
        kind: "text",
        panelId: "t1",
        url: "README.md",
      })
    ).resolves.toBe(true);
    expect(openInstance).toHaveBeenCalledWith(
      expect.objectContaining({
        params: expect.objectContaining({
          source: {
            kind: "disk",
            path: "README.md",
            root: "/repo",
          },
        }),
      })
    );
  });

  it("opens readable text files outside anchors via Files", async () => {
    await expect(
      handleFilesTerminalOpenUrl(context, {
        kind: "text",
        panelId: "t1",
        url: "/tmp/outside.md",
      })
    ).resolves.toBe(true);
    expect(stat).toHaveBeenCalledWith({
      path: "outside.md",
      root: "/tmp",
    });
    expect(openInstance).toHaveBeenCalledWith(
      expect.objectContaining({
        params: expect.objectContaining({
          source: {
            kind: "disk",
            path: "outside.md",
            root: "/tmp",
          },
        }),
        title: "outside.md",
      })
    );
    expect(openPath).not.toHaveBeenCalled();
  });

  it("reports unsupported schemes without system open", async () => {
    await expect(
      handleFilesTerminalOpenUrl(context, {
        kind: "text",
        panelId: "t1",
        url: "local://drag-tab-cross-window-plan.md",
      })
    ).resolves.toBe(true);
    expect(notificationsError).toHaveBeenCalledWith(
      "Cannot open this link in Pier."
    );
    expect(openPath).not.toHaveBeenCalled();
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

  it("reuses an open tab when absolute path matches under a different root split", async () => {
    const existingId = "pier.files.filePanel:disk:abs-split:tab-1";
    listInstances.mockReturnValue([
      {
        groupId: "g1",
        id: existingId,
        params: {
          pinned: false,
          source: {
            kind: "disk",
            path: "src/README.md",
            root: "/repo",
          },
        },
      },
    ]);

    await expect(
      handleFilesTerminalOpenUrl(context, {
        kind: "text",
        panelId: "t1",
        url: "/repo/src/README.md",
      })
    ).resolves.toBe(true);

    expect(openInstance).toHaveBeenCalledWith(
      expect.objectContaining({
        dropUnpinnedInstances: false,
        instanceId: existingId,
      })
    );
    expect(openPath).not.toHaveBeenCalled();
  });

  it("opens binary and unsupported files in Files instead of the system app", async () => {
    // Handler no longer pre-reads; the file panel loads and shows its
    // built-in unsupported / read-only fallback UI.
    await expect(
      handleFilesTerminalOpenUrl(context, {
        kind: "text",
        panelId: "t1",
        url: "/repo/a.zip",
      })
    ).resolves.toBe(true);
    expect(openInstance).toHaveBeenCalledWith(
      expect.objectContaining({
        params: expect.objectContaining({
          source: {
            kind: "disk",
            path: "a.zip",
            root: "/repo",
          },
        }),
        title: "a.zip",
      })
    );
    expect(openPath).not.toHaveBeenCalled();
    expect(readDocument).not.toHaveBeenCalled();
  });

  it("opens unreadable outside-anchor files in Files without system open", async () => {
    await expect(
      handleFilesTerminalOpenUrl(context, {
        kind: "text",
        panelId: "t1",
        url: "/tmp/outside.bin",
      })
    ).resolves.toBe(true);
    expect(openInstance).toHaveBeenCalledWith(
      expect.objectContaining({
        params: expect.objectContaining({
          source: {
            kind: "disk",
            path: "outside.bin",
            root: "/tmp",
          },
        }),
        title: "outside.bin",
      })
    );
    expect(openPath).not.toHaveBeenCalled();
  });

  it("logs why system open fallback is used when openInstance throws", async () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => undefined);
    openInstance.mockImplementation(() => {
      throw new Error("panel not registered");
    });
    try {
      await expect(
        handleFilesTerminalOpenUrl(context, {
          kind: "text",
          panelId: "t1",
          url: "/tmp/outside.bin",
        })
      ).resolves.toBe(true);
      expect(info).toHaveBeenCalledWith(
        "[files-terminal-open-url] system open fallback",
        expect.objectContaining({
          path: "/tmp/outside.bin",
          reason: "open-instance-failed",
        })
      );
      expect(openPath).toHaveBeenCalledWith({ path: "/tmp/outside.bin" });
    } finally {
      info.mockRestore();
    }
  });
});
