import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  detachWorktreePreferencesListener,
  initWorktreePreferences,
  useWorktreePreferencesStore,
} from "@/stores/worktree-preferences.store.ts";

interface WorktreePreferencesSnapshot {
  worktreeBranchPrefix?: string;
  worktreeRootPath: string;
}
type PreferencesChangedCallback = (next: WorktreePreferencesSnapshot) => void;

describe("useWorktreePreferencesStore", () => {
  let changedCallback: PreferencesChangedCallback | null;
  const detachMock = vi.fn();
  const readMock = vi.fn<() => Promise<WorktreePreferencesSnapshot>>();
  const updateMock =
    vi.fn<
      (patch: {
        worktreeRootPath?: string;
      }) => Promise<WorktreePreferencesSnapshot>
    >();

  beforeEach(() => {
    changedCallback = null;
    detachWorktreePreferencesListener();
    detachMock.mockReset();
    readMock.mockReset();
    updateMock.mockReset();
    useWorktreePreferencesStore.setState({
      worktreeRootPath: "",
    } as never);
    vi.stubGlobal("window", {
      ...window,
      pier: {
        preferences: {
          onChanged: (cb: PreferencesChangedCallback) => {
            changedCallback = cb;
            return detachMock;
          },
          read: readMock,
          update: updateMock,
        },
      },
    });
  });

  afterEach(() => {
    detachWorktreePreferencesListener();
    vi.unstubAllGlobals();
  });

  it("does not expose the removed branch prefix before IPC hydration", () => {
    expect(useWorktreePreferencesStore.getInitialState()).not.toHaveProperty(
      "worktreeBranchPrefix"
    );
    expect(useWorktreePreferencesStore.getInitialState()).not.toHaveProperty(
      "setWorktreeBranchPrefix"
    );
  });

  it("initWorktreePreferences hydrates worktree root path and attaches one broadcast listener", async () => {
    readMock.mockResolvedValue({
      worktreeBranchPrefix: "legacy/",
      worktreeRootPath: "/Volumes/worktrees",
    });

    await initWorktreePreferences();

    expect(readMock).toHaveBeenCalledTimes(1);
    expect(useWorktreePreferencesStore.getState().worktreeRootPath).toBe(
      "/Volumes/worktrees"
    );
    expect(useWorktreePreferencesStore.getState()).not.toHaveProperty(
      "worktreeBranchPrefix"
    );
    expect(changedCallback).not.toBeNull();
  });

  it("setWorktreeRootPath trims the outgoing patch and hydrates the root path from the merged update snapshot", async () => {
    updateMock.mockResolvedValue({
      worktreeBranchPrefix: "legacy/",
      worktreeRootPath: "/remote/merged",
    });

    await useWorktreePreferencesStore
      .getState()
      .setWorktreeRootPath("  /local/input  ");

    expect(updateMock).toHaveBeenCalledWith({
      worktreeRootPath: "/local/input",
    });
    expect(useWorktreePreferencesStore.getState().worktreeRootPath).toBe(
      "/remote/merged"
    );
    expect(useWorktreePreferencesStore.getState()).not.toHaveProperty(
      "worktreeBranchPrefix"
    );
  });

  it("preferences.onChanged broadcasts rehydrate only the root path", async () => {
    readMock.mockResolvedValue({
      worktreeBranchPrefix: "initial/",
      worktreeRootPath: "/initial",
    });
    await initWorktreePreferences();

    changedCallback?.({
      worktreeBranchPrefix: "broadcast/",
      worktreeRootPath: "/from/broadcast",
    });

    expect(useWorktreePreferencesStore.getState().worktreeRootPath).toBe(
      "/from/broadcast"
    );
    expect(useWorktreePreferencesStore.getState()).not.toHaveProperty(
      "worktreeBranchPrefix"
    );
  });
});
