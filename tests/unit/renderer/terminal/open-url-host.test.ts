import { toast } from "sonner";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { addTerminalOpenUrlHandler } from "../../../../src/plugins/api/terminal-open-url-handlers.ts";
import {
  installTerminalOpenUrlHost,
  resetTerminalOpenUrlHostForTests,
} from "../../../../src/renderer/lib/plugins/terminal-open-url-host.ts";

const openFilesDiskPath = vi.fn(() => false);
const getTerminalPanelContext = vi.fn(() => null);

vi.mock("i18next", () => ({
  default: {
    t: (key: string) => {
      const map: Record<string, string> = {
        "terminal.openPathFailed": "Couldn't open path",
        "terminal.openPathInvalid": "Couldn't open this path",
        "terminal.openPathRelativeWithoutCwd": "No working directory",
        "terminal.openPathUnsupportedScheme": "Couldn't open this link",
      };
      return map[key] ?? key;
    },
  },
}));

vi.mock("@/lib/files/open-disk-file-panel.ts", () => ({
  openFilesDiskPath: (...args: unknown[]) => openFilesDiskPath(...args),
}));

vi.mock(
  "../../../../src/renderer/lib/plugins/host/terminal-context.ts",
  () => ({
    getTerminalPanelContext: (...args: unknown[]) =>
      getTerminalPanelContext(...args),
  })
);

describe("terminal-open-url-host", () => {
  let openPath: ReturnType<typeof vi.fn>;
  let stat: ReturnType<typeof vi.fn>;
  let emit: ((url: string) => void) | null;

  beforeEach(() => {
    resetTerminalOpenUrlHostForTests();
    openPath = vi.fn(async () => ({ opened: true as const }));
    stat = vi.fn(async (request: { path: string; root: string }) => ({
      exists: true,
      isDirectory: false,
      mtimeMs: 1,
      path: request.path,
      root: request.root,
      size: 1,
    }));
    openFilesDiskPath.mockReset();
    openFilesDiskPath.mockReturnValue(false);
    getTerminalPanelContext.mockReset();
    getTerminalPanelContext.mockReturnValue(null);
    emit = null;
    vi.stubGlobal("window", {
      pier: {
        files: { openPath, stat },
        terminal: {
          onOpenUrl: (
            cb: (event: { kind: "text"; panelId: string; url: string }) => void
          ) => {
            emit = (url: string) => {
              cb({ kind: "text", panelId: "t1", url });
            };
            return () => {
              emit = null;
            };
          },
        },
      },
    });
    installTerminalOpenUrlHost();
  });

  it("does not openPath when a handler consumes the event", async () => {
    addTerminalOpenUrlHandler(async () => true);
    emit?.("/repo/a.md");
    await Promise.resolve();
    await Promise.resolve();
    expect(openFilesDiskPath).not.toHaveBeenCalled();
    expect(openPath).not.toHaveBeenCalled();
  });

  it("opens absolute local paths via Pier Files first", async () => {
    openFilesDiskPath.mockReturnValue(true);
    emit?.("/tmp/a.md");
    await vi.waitFor(() => {
      expect(openFilesDiskPath).toHaveBeenCalledWith(
        expect.objectContaining({
          path: "a.md",
          root: "/tmp",
        })
      );
    });
    expect(openPath).not.toHaveBeenCalled();
  });

  it("never system-opens TypeScript when Files is unavailable", async () => {
    openFilesDiskPath.mockReturnValue(false);
    const errorSpy = vi.spyOn(toast, "error").mockImplementation(() => "");
    emit?.("/repo/src/foo.test.ts");
    await vi.waitFor(() => {
      expect(openFilesDiskPath).toHaveBeenCalled();
      expect(errorSpy).toHaveBeenCalledWith("Couldn't open path");
    });
    expect(openPath).not.toHaveBeenCalled();
    errorSpy.mockRestore();
  });

  it("never system-opens markdown when Files is unavailable", async () => {
    openFilesDiskPath.mockReturnValue(false);
    const errorSpy = vi.spyOn(toast, "error").mockImplementation(() => "");
    emit?.("/tmp/a.md");
    await vi.waitFor(() => {
      expect(openFilesDiskPath).toHaveBeenCalled();
      expect(errorSpy).toHaveBeenCalledWith("Couldn't open path");
    });
    expect(openPath).not.toHaveBeenCalled();
    errorSpy.mockRestore();
  });

  it("falls back to openPath for non-source absolute paths when Files fails", async () => {
    openFilesDiskPath.mockReturnValue(false);
    emit?.("/tmp/clip.mp4");
    await vi.waitFor(() => {
      expect(openPath).toHaveBeenCalledWith({ path: "/tmp/clip.mp4" });
    });
  });

  it("ignores remote urls in host fallback", async () => {
    emit?.("https://example.com");
    await Promise.resolve();
    await Promise.resolve();
    expect(openFilesDiskPath).not.toHaveBeenCalled();
    expect(openPath).not.toHaveBeenCalled();
  });

  it("toasts a specific message for relative paths without cwd", async () => {
    const errorSpy = vi.spyOn(toast, "error").mockImplementation(() => "");
    emit?.("docs/a.md");
    await vi.waitFor(() => {
      expect(errorSpy).toHaveBeenCalledWith("No working directory");
    });
    expect(openPath).not.toHaveBeenCalled();
    errorSpy.mockRestore();
  });

  it("toasts a specific message for unsupported schemes", async () => {
    const errorSpy = vi.spyOn(toast, "error").mockImplementation(() => "");
    emit?.("vscode://file/tmp/a.ts");
    await vi.waitFor(() => {
      expect(errorSpy).toHaveBeenCalledWith("Couldn't open this link");
    });
    expect(openPath).not.toHaveBeenCalled();
    errorSpy.mockRestore();
  });

  it("toasts when openPath fails for allow-listed OS paths", async () => {
    openFilesDiskPath.mockReturnValue(false);
    const errorSpy = vi.spyOn(toast, "error").mockImplementation(() => "");
    openPath.mockResolvedValueOnce({
      opened: false as const,
      reason: "open-failed" as const,
    });
    emit?.("/tmp/missing.bin");
    await vi.waitFor(() => {
      expect(openPath).toHaveBeenCalledWith({ path: "/tmp/missing.bin" });
      expect(errorSpy).toHaveBeenCalledWith("Couldn't open path");
    });
    errorSpy.mockRestore();
  });

  it("resolves relative paths with anchor-aware root/path", async () => {
    getTerminalPanelContext.mockReturnValue({
      contextId: "c",
      cwd: "/repo",
      projectRootPath: "/repo",
      updatedAt: 1,
    });
    openFilesDiskPath.mockReturnValue(true);
    emit?.("docs/a.md");
    await vi.waitFor(() => {
      expect(openFilesDiskPath).toHaveBeenCalledWith(
        expect.objectContaining({
          path: "docs/a.md",
          root: "/repo",
          context: expect.objectContaining({ projectRootPath: "/repo" }),
        })
      );
    });
    expect(openPath).not.toHaveBeenCalled();
  });

  it("skips missing multi-root candidates then opens the existing one", async () => {
    getTerminalPanelContext.mockReturnValue({
      contextId: "c",
      cwd: "/repo/src",
      projectRootPath: "/repo",
      worktreeRoot: "/repo",
      updatedAt: 1,
    });
    stat.mockImplementation(async (request: { path: string; root: string }) => {
      const exists = request.root === "/repo" && request.path === "docs/a.md";
      return {
        exists,
        isDirectory: false,
        mtimeMs: 1,
        path: request.path,
        root: request.root,
        size: 1,
      };
    });
    openFilesDiskPath.mockReturnValue(true);
    emit?.("docs/a.md");
    await vi.waitFor(() => {
      expect(openFilesDiskPath).toHaveBeenCalledWith(
        expect.objectContaining({
          path: "docs/a.md",
          root: "/repo",
        })
      );
    });
    // First candidate under cwd was missing — only project-root open should land.
    expect(openFilesDiskPath).toHaveBeenCalledTimes(1);
    expect(openPath).not.toHaveBeenCalled();
  });

  it("opens directories with the OS opener, not a document panel", async () => {
    stat.mockResolvedValueOnce({
      exists: true,
      isDirectory: true,
      mtimeMs: 1,
      path: "docs",
      root: "/repo",
      size: 0,
    });
    getTerminalPanelContext.mockReturnValue({
      contextId: "c",
      cwd: "/repo",
      projectRootPath: "/repo",
      updatedAt: 1,
    });
    emit?.("/repo/docs");
    await vi.waitFor(() => {
      expect(openPath).toHaveBeenCalledWith({ path: "/repo/docs" });
    });
    expect(openFilesDiskPath).not.toHaveBeenCalled();
  });
});
