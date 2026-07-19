import type {
  ExternalRendererPluginContext,
  RendererPluginQuickPick,
} from "@pier/plugin-api/renderer";
import { describe, expect, it, vi } from "vitest";
import {
  openHostTerminal,
  openSshTerminalPicker,
} from "../../../packages/plugin-ssh/src/renderer/open-host-terminal.tsx";
import type { SshHost } from "../../../packages/plugin-ssh/src/shared/hosts.ts";

const host: SshHost = {
  host: "example.com",
  id: "host-1",
  name: "Example",
  port: 2222,
  user: "dev",
};

const t = (key: string, fallback?: string): string => fallback ?? key;

function createContext(options?: {
  snapshotError?: Error;
  terminalError?: Error;
}): {
  context: ExternalRendererPluginContext;
  loading: {
    dismiss: ReturnType<typeof vi.fn>;
    info: ReturnType<typeof vi.fn>;
    success: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
  };
  openQuickPick: ReturnType<typeof vi.fn>;
  terminalOpen: ReturnType<typeof vi.fn>;
} {
  const loading = {
    dismiss: vi.fn(),
    info: vi.fn(),
    success: vi.fn(),
    update: vi.fn(),
  };
  const openQuickPick = vi.fn();
  const terminalOpen = options?.terminalError
    ? vi.fn(() => Promise.reject(options.terminalError))
    : vi.fn(() =>
        Promise.resolve({ panelId: "terminal-1", windowId: "window-1" })
      );
  const context = {
    app: {
      closeSettings: vi.fn(),
      openSettings: vi.fn(),
    },
    commandPalette: {
      openQuickPick,
      updateQuickPick: vi.fn(),
    },
    notifications: {
      info: vi.fn(),
      loading: vi.fn(() => loading),
    },
    rpc: {
      invoke: options?.snapshotError
        ? vi.fn(() => Promise.reject(options.snapshotError))
        : vi.fn(() => Promise.resolve({ hosts: [host] })),
    },
    terminals: {
      open: terminalOpen,
    },
  } as unknown as ExternalRendererPluginContext;
  return { context, loading, openQuickPick, terminalOpen };
}

describe("SSH terminal opening", () => {
  it("uses a command-palette quick pick and shows terminal launch progress", async () => {
    const { context, loading, openQuickPick, terminalOpen } = createContext();

    await openSshTerminalPicker({ context, onError: vi.fn(), t });

    expect(openQuickPick).toHaveBeenCalledOnce();
    const quickPick = openQuickPick.mock
      .calls[0]?.[0] as RendererPluginQuickPick;
    expect(quickPick.items).toEqual([
      expect.objectContaining({
        description: "dev@example.com:2222",
        id: "host-1",
        label: "Example",
      }),
    ]);

    await quickPick.onAccept(
      quickPick.items?.[0] as NonNullable<
        RendererPluginQuickPick["items"]
      >[number]
    );

    expect(context.notifications.loading).toHaveBeenCalledWith(
      "Opening SSH terminal…"
    );
    expect(terminalOpen).toHaveBeenCalledWith({
      launch: { command: "ssh -p 2222 -- dev@example.com" },
    });
    expect(loading.success).toHaveBeenCalledWith("SSH terminal opened");
  });

  it("dismisses launch progress and reports terminal creation failures", async () => {
    const error = new Error("terminal failed");
    const onError = vi.fn();
    const { context, loading } = createContext({ terminalError: error });

    await openHostTerminal({ context, host, onError, t });

    expect(loading.dismiss).toHaveBeenCalledOnce();
    expect(loading.success).not.toHaveBeenCalled();
    expect(onError).toHaveBeenCalledWith(error);
  });

  it("reports and propagates host snapshot failures", async () => {
    const error = new Error("snapshot failed");
    const onError = vi.fn();
    const { context, openQuickPick } = createContext({ snapshotError: error });

    await expect(
      openSshTerminalPicker({ context, onError, t })
    ).rejects.toThrow("snapshot failed");
    expect(onError).toHaveBeenCalledWith(error);
    expect(openQuickPick).not.toHaveBeenCalled();
  });
});
