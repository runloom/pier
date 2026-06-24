import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

describe("terminal session state", () => {
  let userDataDir: string;

  beforeEach(async () => {
    vi.resetModules();
    userDataDir = await mkdtemp(join(tmpdir(), "pier-terminal-session-"));
    vi.doMock("electron", () => ({
      app: {
        getPath: vi.fn((name: string) => {
          if (name !== "userData") {
            throw new Error(`unexpected app path: ${name}`);
          }
          return userDataDir;
        }),
      },
    }));
  });

  afterEach(async () => {
    vi.resetModules();
    vi.restoreAllMocks();
    await rm(userDataDir, { force: true, recursive: true });
  });

  it("persists and reads the last cwd by window and panel", async () => {
    const { readTerminalPanelSession, updateTerminalPanelCwd } = await import(
      "@main/state/terminal-session-state.ts"
    );

    await updateTerminalPanelCwd("main", "terminal-1", "/Users/xyz/ABC/pier");

    await expect(
      readTerminalPanelSession("main", "terminal-1")
    ).resolves.toMatchObject({
      cwd: "/Users/xyz/ABC/pier",
    });
    await expect(
      readTerminalPanelSession("w-2", "terminal-1")
    ).resolves.toBeNull();
  });

  it("ignores blank and relative cwd updates", async () => {
    const { readTerminalPanelSession, updateTerminalPanelCwd } = await import(
      "@main/state/terminal-session-state.ts"
    );

    await updateTerminalPanelCwd("main", "terminal-1", "");
    await updateTerminalPanelCwd("main", "terminal-1", "relative/path");

    await expect(
      readTerminalPanelSession("main", "terminal-1")
    ).resolves.toBeNull();
  });
});
