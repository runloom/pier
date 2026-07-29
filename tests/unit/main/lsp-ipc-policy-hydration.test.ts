import { DEFAULT_LSP_POLICY_PREFS } from "@shared/contracts/lsp.ts";
import { PIER } from "@shared/ipc-channels.ts";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  handlers: new Map<string, (event: unknown, payload: unknown) => unknown>(),
  readPrefs: vi.fn(),
  subscribe: vi.fn(),
}));

vi.mock("electron", () => ({
  ipcMain: {
    handle: vi.fn(
      (
        channel: string,
        handler: (event: unknown, payload: unknown) => unknown
      ) => {
        mocks.handlers.set(channel, handler);
      }
    ),
  },
}));

vi.mock("@main/app-core/app-core.ts", () => ({
  appCore: {
    clients: {
      heartbeat: vi.fn(() => ({ capabilities: ["file:read"] })),
      register: vi.fn(),
    },
    eventBus: { subscribe: mocks.subscribe },
    services: { preferences: { read: mocks.readPrefs } },
  },
}));

vi.mock("@main/windows/window-manager.ts", () => ({
  windowManager: {
    findInternalIdByWindow: vi.fn(() => "window-1"),
    fromWebContents: vi.fn(() => ({})),
    getAll: vi.fn(() => []),
  },
}));

import {
  disposeLspIpcHost,
  getLspIpcTestHandles,
  registerLspIpc,
} from "@main/ipc/lsp.ts";

function event() {
  const mainFrame = {};
  const sender = {
    id: 7,
    isDestroyed: vi.fn(() => false),
    mainFrame,
    on: vi.fn(),
    once: vi.fn(),
    send: vi.fn(),
  };
  return { sender, senderFrame: mainFrame };
}

describe("LSP IPC policy hydration", () => {
  beforeEach(() => {
    mocks.handlers.clear();
    mocks.readPrefs.mockReset();
    mocks.subscribe.mockReset();
  });

  it("hydrates saved policy before the first LanguageTools acquire", async () => {
    mocks.readPrefs.mockResolvedValue({
      lsp: { ...DEFAULT_LSP_POLICY_PREFS, enabled: false },
    });
    const resolveLaunch = vi.fn(() => null);
    getLspIpcTestHandles().registry.register({
      displayName: "Test LSP",
      id: "test-policy-hydration",
      languageIdForPath: () => "typescript",
      matchPath: () => true,
      priority: Number.MAX_SAFE_INTEGER,
      resolveLaunch,
      resolveRoot: ({ fallbackWorkspaceRoot }) => fallbackWorkspaceRoot,
      rootMarkers: [],
      selector: { extensions: [".ts"], languageIds: ["typescript"] },
    });
    registerLspIpc();
    const handler = mocks.handlers.get(PIER.LSP_LANGUAGE_TOOLS_REQUEST);
    if (!handler) {
      throw new Error("expected LanguageTools request handler");
    }

    await expect(
      handler(event(), {
        filePath: "/repo/src/index.ts",
        method: "textDocument/definition",
        params: {},
        rootPath: "/repo",
      })
    ).resolves.toEqual({
      ok: false,
      reason: "globally-disabled",
      result: null,
    });
    expect(mocks.readPrefs).toHaveBeenCalledTimes(1);
    expect(resolveLaunch).not.toHaveBeenCalled();
  });
});

afterAll(async () => {
  await disposeLspIpcHost();
});
