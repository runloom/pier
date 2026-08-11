import { afterEach, describe, expect, it, vi } from "vitest";

const spawnSyncMock = vi.hoisted(() => vi.fn());

vi.mock("node:child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:child_process")>();
  return {
    ...actual,
    default: { ...actual, spawnSync: spawnSyncMock },
    spawnSync: spawnSyncMock,
  };
});

import { createBootstrappedLspRegistry } from "../../../../src/main/services/lsp/bootstrap-providers.ts";

afterEach(() => {
  spawnSyncMock.mockReset();
  vi.restoreAllMocks();
});

describe("Pyright LSP provider", () => {
  it("launches a Windows command shim through ComSpec", async () => {
    vi.spyOn(process, "platform", "get").mockReturnValue("win32");
    spawnSyncMock.mockReturnValue({
      status: 0,
      stdout: "C:\\Users\\me\\bin\\pyright-langserver.cmd\r\n",
    });

    const provider = createBootstrappedLspRegistry().getById("pyright");
    expect(provider).not.toBeNull();
    const launch = await provider!.resolveLaunch({
      rootPath: "C:\\repo",
      workspaceKey: "main:C:/repo",
    });

    expect(launch).toEqual({
      args: [
        "/d",
        "/s",
        "/c",
        '"C:\\Users\\me\\bin\\pyright-langserver.cmd" --stdio',
      ],
      command: process.env.ComSpec ?? "cmd.exe",
      cwd: "C:/repo",
    });
  });
});
