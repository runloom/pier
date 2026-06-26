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

  it("persists and reads the last terminal title by window and panel", async () => {
    const {
      readTerminalPanelSession,
      updateTerminalPanelCwd,
      updateTerminalPanelTitle,
    } = await import("@main/state/terminal-session-state.ts");

    await updateTerminalPanelCwd("main", "terminal-1", "/Users/xyz/ABC/pier");
    await updateTerminalPanelTitle("main", "terminal-1", "Claude Code");

    await expect(
      readTerminalPanelSession("main", "terminal-1")
    ).resolves.toMatchObject({
      cwd: "/Users/xyz/ABC/pier",
      title: "Claude Code",
    });
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

  it("serializes concurrent cwd updates without dropping panel sessions", async () => {
    const { readTerminalPanelSession, updateTerminalPanelCwd } = await import(
      "@main/state/terminal-session-state.ts"
    );

    await expect(
      Promise.all(
        Array.from({ length: 20 }, (_, index) =>
          updateTerminalPanelCwd(
            "main",
            `terminal-${index}`,
            `/tmp/pier-terminal-${index}`
          )
        )
      )
    ).resolves.toHaveLength(20);

    for (let index = 0; index < 20; index += 1) {
      await expect(
        readTerminalPanelSession("main", `terminal-${index}`)
      ).resolves.toMatchObject({
        cwd: `/tmp/pier-terminal-${index}`,
      });
    }
  });

  it("archives a closed terminal session for the current window", async () => {
    const {
      archiveTerminalPanelSession,
      listRecentTerminalPanelSessions,
      readTerminalPanelSession,
      removeTerminalPanelSession,
      updateTerminalPanelCwd,
      updateTerminalPanelTitle,
    } = await import("@main/state/terminal-session-state.ts");

    await updateTerminalPanelCwd("main", "terminal-1", "/Users/xyz/ABC/pier");
    await updateTerminalPanelTitle("main", "terminal-1", "Claude Code");

    await archiveTerminalPanelSession("main", "terminal-1");
    await removeTerminalPanelSession("main", "terminal-1");

    await expect(
      readTerminalPanelSession("main", "terminal-1")
    ).resolves.toBeNull();
    await expect(listRecentTerminalPanelSessions("main")).resolves.toEqual([
      expect.objectContaining({
        cwd: "/Users/xyz/ABC/pier",
        panelId: "terminal-1",
        title: "Claude Code",
      }),
    ]);
    await expect(listRecentTerminalPanelSessions("w-2")).resolves.toEqual([]);
  });

  it("keeps recent closed terminal sessions newest first and capped at 20", async () => {
    const {
      archiveTerminalPanelSession,
      listRecentTerminalPanelSessions,
      removeTerminalPanelSession,
      updateTerminalPanelCwd,
    } = await import("@main/state/terminal-session-state.ts");

    for (let index = 0; index < 25; index += 1) {
      const panelId = `terminal-${index}`;
      await updateTerminalPanelCwd("main", panelId, `/tmp/pier-${index}`);
      await archiveTerminalPanelSession("main", panelId);
      await removeTerminalPanelSession("main", panelId);
    }

    const recent = await listRecentTerminalPanelSessions("main");
    expect(recent).toHaveLength(20);
    expect(recent[0]).toMatchObject({
      cwd: "/tmp/pier-24",
      panelId: "terminal-24",
    });
    expect(recent.at(-1)).toMatchObject({
      cwd: "/tmp/pier-5",
      panelId: "terminal-5",
    });
  });

  it("does not archive a closed terminal session without a cwd", async () => {
    const {
      archiveTerminalPanelSession,
      listRecentTerminalPanelSessions,
      updateTerminalPanelTitle,
    } = await import("@main/state/terminal-session-state.ts");

    await updateTerminalPanelTitle("main", "terminal-1", "Shell");

    await archiveTerminalPanelSession("main", "terminal-1");

    await expect(listRecentTerminalPanelSessions("main")).resolves.toEqual([]);
  });

  it("lists recent closed terminal sessions from every window scope", async () => {
    const {
      archiveTerminalPanelSession,
      listAllRecentTerminalPanelSessions,
      removeTerminalPanelSession,
      updateTerminalPanelCwd,
    } = await import("@main/state/terminal-session-state.ts");

    await updateTerminalPanelCwd("record-main", "terminal-1", "/tmp/pier");
    await archiveTerminalPanelSession("record-main", "terminal-1");
    await removeTerminalPanelSession("record-main", "terminal-1");

    await updateTerminalPanelCwd("record-bay", "terminal-2", "/tmp/bay");
    await archiveTerminalPanelSession("record-bay", "terminal-2");
    await removeTerminalPanelSession("record-bay", "terminal-2");

    await expect(listAllRecentTerminalPanelSessions()).resolves.toEqual([
      expect.objectContaining({
        cwd: "/tmp/bay",
        panelId: "terminal-2",
        recordId: "record-bay",
      }),
      expect.objectContaining({
        cwd: "/tmp/pier",
        panelId: "terminal-1",
        recordId: "record-main",
      }),
    ]);
  });
});
