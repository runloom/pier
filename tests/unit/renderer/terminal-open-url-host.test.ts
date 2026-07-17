import { toast } from "sonner";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { addTerminalOpenUrlHandler } from "../../../src/plugins/api/terminal-open-url-handlers.ts";
import {
  installTerminalOpenUrlHost,
  resetTerminalOpenUrlHostForTests,
} from "../../../src/renderer/lib/plugins/terminal-open-url-host.ts";

describe("terminal-open-url-host", () => {
  let openPath: ReturnType<typeof vi.fn>;
  let emit: ((url: string) => void) | null;

  beforeEach(() => {
    resetTerminalOpenUrlHostForTests();
    openPath = vi.fn(async () => ({ opened: true as const }));
    emit = null;
    vi.stubGlobal("window", {
      pier: {
        files: { openPath },
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
    expect(openPath).not.toHaveBeenCalled();
  });

  it("falls back to openPath for absolute local paths", async () => {
    emit?.("/tmp/a.md");
    await vi.waitFor(() => {
      expect(openPath).toHaveBeenCalledWith({ path: "/tmp/a.md" });
    });
  });

  it("ignores remote urls in host fallback", async () => {
    emit?.("https://example.com");
    await Promise.resolve();
    await Promise.resolve();
    expect(openPath).not.toHaveBeenCalled();
  });

  it("toasts when openPath fails", async () => {
    const errorSpy = vi.spyOn(toast, "error").mockImplementation(() => "");
    openPath.mockResolvedValueOnce({
      opened: false as const,
      reason: "open-failed" as const,
    });
    emit?.("/tmp/missing.md");
    await vi.waitFor(() => {
      expect(openPath).toHaveBeenCalledWith({ path: "/tmp/missing.md" });
      expect(errorSpy).toHaveBeenCalledWith("Unable to open path.");
    });
    errorSpy.mockRestore();
  });
});
