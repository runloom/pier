import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { PanelContext } from "@shared/contracts/panel.ts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

function context(root: string, updatedAt = 1_772_000_000_000): PanelContext {
  return {
    contextId: `ctx:${root}`,
    cwd: root,
    openedPath: root,
    projectRoot: root,
    source: "panel",
    updatedAt,
    worktreeKey: root,
  };
}

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

  it("persists and reads the last context by window and panel", async () => {
    const { readTerminalPanelSession, updateTerminalPanelContext } =
      await import("@main/state/terminal-session-state.ts");

    const pier = context("/Users/xyz/ABC/pier");
    await updateTerminalPanelContext("main", "terminal-1", pier);

    await expect(
      readTerminalPanelSession("main", "terminal-1")
    ).resolves.toMatchObject({ context: pier });
    await expect(
      readTerminalPanelSession("w-2", "terminal-1")
    ).resolves.toBeNull();
  });

  it("persists and reads the last terminal title with context", async () => {
    const {
      readTerminalPanelSession,
      updateTerminalPanelContext,
      updateTerminalPanelTitle,
    } = await import("@main/state/terminal-session-state.ts");

    const pier = context("/Users/xyz/ABC/pier");
    await updateTerminalPanelContext("main", "terminal-1", pier);
    await updateTerminalPanelTitle("main", "terminal-1", "Claude Code");

    await expect(
      readTerminalPanelSession("main", "terminal-1")
    ).resolves.toMatchObject({
      context: pier,
      title: "Claude Code",
    });
  });

  it("persists and patches tab chrome without requiring business state storage", async () => {
    const {
      patchTerminalPanelTab,
      readTerminalPanelSession,
      updateTerminalPanelContext,
      updateTerminalPanelTab,
    } = await import("@main/state/terminal-session-state.ts");

    const pier = context("/Users/xyz/ABC/pier");
    await updateTerminalPanelContext("main", "terminal-1", pier);
    await updateTerminalPanelTab("main", "terminal-1", {
      badge: { label: "package.json" },
      icon: { id: "pier.task" },
      state: { busy: true, label: "Running" },
      title: "test",
    });
    await patchTerminalPanelTab("main", "terminal-1", {
      state: {
        busy: false,
        colorToken: "success",
        label: "Succeeded",
      },
    });

    await expect(
      readTerminalPanelSession("main", "terminal-1")
    ).resolves.toMatchObject({
      context: pier,
      tab: {
        badge: { label: "package.json" },
        icon: { id: "pier.task" },
        state: {
          busy: false,
          colorToken: "success",
          label: "Succeeded",
        },
        title: "test",
      },
    });
  });

  it("does not create a session for a title without context", async () => {
    const { readTerminalPanelSession, updateTerminalPanelTitle } = await import(
      "@main/state/terminal-session-state.ts"
    );

    await updateTerminalPanelTitle("main", "terminal-1", "Shell");

    await expect(
      readTerminalPanelSession("main", "terminal-1")
    ).resolves.toBeNull();
  });

  it("serializes concurrent context updates without dropping panel sessions", async () => {
    const { readTerminalPanelSession, updateTerminalPanelContext } =
      await import("@main/state/terminal-session-state.ts");

    await expect(
      Promise.all(
        Array.from({ length: 20 }, (_, index) =>
          updateTerminalPanelContext(
            "main",
            `terminal-${index}`,
            context(`/tmp/pier-terminal-${index}`, index)
          )
        )
      )
    ).resolves.toHaveLength(20);

    for (let index = 0; index < 20; index += 1) {
      await expect(
        readTerminalPanelSession("main", `terminal-${index}`)
      ).resolves.toMatchObject({
        context: context(`/tmp/pier-terminal-${index}`, index),
      });
    }
  });

  it("removes a closed terminal session without keeping a recent-closed list", async () => {
    const {
      readTerminalPanelSession,
      removeTerminalPanelSession,
      updateTerminalPanelContext,
      updateTerminalPanelTitle,
    } = await import("@main/state/terminal-session-state.ts");

    const pier = context("/Users/xyz/ABC/pier");
    await updateTerminalPanelContext("main", "terminal-1", pier);
    await updateTerminalPanelTitle("main", "terminal-1", "Claude Code");

    await removeTerminalPanelSession("main", "terminal-1");

    await expect(
      readTerminalPanelSession("main", "terminal-1")
    ).resolves.toBeNull();
  });

  it("normalizes state to panel sessions only", async () => {
    const pier = context("/Users/xyz/ABC/pier");
    await writeFile(
      join(userDataDir, "terminal-session-state.json"),
      JSON.stringify({
        version: 1,
        windows: {
          main: {
            panels: {
              "terminal-1": {
                context: pier,
                title: "Claude Code",
                updatedAt: "2026-06-26T00:00:00.000Z",
              },
            },
            recentClosed: [
              {
                closedAt: "2026-06-26T00:00:01.000Z",
                context: pier,
                id: "terminal-1:2026-06-26T00:00:01.000Z",
                panelId: "terminal-1",
              },
            ],
          },
        },
      })
    );

    const { flushTerminalSessionState, readTerminalPanelSession } =
      await import("@main/state/terminal-session-state.ts");

    await expect(
      readTerminalPanelSession("main", "terminal-1")
    ).resolves.toMatchObject({
      context: pier,
      title: "Claude Code",
    });
    await flushTerminalSessionState();

    const stored = JSON.parse(
      await readFile(join(userDataDir, "terminal-session-state.json"), "utf-8")
    );
    expect(stored).toEqual({
      version: 1,
      windows: {
        main: {
          panels: {
            "terminal-1": {
              context: pier,
              title: "Claude Code",
              updatedAt: "2026-06-26T00:00:00.000Z",
            },
          },
        },
      },
    });
  });
});
