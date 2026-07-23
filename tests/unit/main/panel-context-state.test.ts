import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { PanelContext } from "@shared/contracts/panel.ts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

function context(
  id: string,
  root: string,
  updatedAt: number,
  overrides: Partial<PanelContext> = {}
): PanelContext {
  return {
    contextId: id,
    cwd: root,
    openedPath: root,
    projectRootPath: root,
    source: "panel",
    updatedAt,
    worktreeKey: root,
    ...overrides,
  };
}

describe("panel context state", () => {
  let userDataDir: string;

  beforeEach(async () => {
    vi.resetModules();
    userDataDir = await mkdtemp(join(tmpdir(), "pier-panel-context-state-"));
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

  it("persists recent contexts and dedupes by worktree key", async () => {
    const {
      flushPanelContextState,
      readRecentPanelContexts,
      recordRecentPanelContext,
    } = await import("@main/state/panel-context-state.ts");

    const pier = context("ctx-pier", "/Users/dev/ABC/pier", 100);
    const pierUpdated = context("ctx-pier-next", "/Users/dev/ABC/pier", 300, {
      branch: "feature/panel-context",
    });
    const bay = context("ctx-bay", "/Users/dev/ABC/bay", 200);

    await recordRecentPanelContext(pier);
    await recordRecentPanelContext(bay);
    await recordRecentPanelContext(pierUpdated);

    await expect(readRecentPanelContexts()).resolves.toEqual([
      pierUpdated,
      bay,
    ]);

    await flushPanelContextState();
    vi.resetModules();
    vi.doMock("electron", () => ({
      app: { getPath: vi.fn(() => userDataDir) },
    }));
    const restored = await import("@main/state/panel-context-state.ts");

    await expect(restored.readRecentPanelContexts()).resolves.toEqual([
      pierUpdated,
      bay,
    ]);
  });

  it("caps recent contexts at 20 newest entries", async () => {
    const { readRecentPanelContexts, recordRecentPanelContext } = await import(
      "@main/state/panel-context-state.ts"
    );

    for (let index = 0; index < 25; index += 1) {
      await recordRecentPanelContext(
        context(`ctx-${index}`, `/tmp/pier-${index}`, index)
      );
    }

    const recent = await readRecentPanelContexts();
    expect(recent).toHaveLength(20);
    expect(recent[0]?.contextId).toBe("ctx-24");
    expect(recent.at(-1)?.contextId).toBe("ctx-5");
  });

  it("normalizes state to recent contexts only", async () => {
    const pier = context("ctx-pier", "/Users/dev/ABC/pier", 100);
    await writeFile(
      join(userDataDir, "panel-context-state.json"),
      JSON.stringify({
        active: pier,
        recent: [pier],
        version: 1,
      })
    );

    const { flushPanelContextState, readRecentPanelContexts } = await import(
      "@main/state/panel-context-state.ts"
    );

    await expect(readRecentPanelContexts()).resolves.toEqual([pier]);
    await flushPanelContextState();

    const stored = JSON.parse(
      await readFile(join(userDataDir, "panel-context-state.json"), "utf-8")
    );
    expect(stored).toEqual({
      recent: [pier],
      version: 1,
    });
  });
});
