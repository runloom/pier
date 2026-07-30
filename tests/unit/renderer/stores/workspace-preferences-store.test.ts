import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  detachWorkspacePreferencesListener,
  initWorkspacePreferences,
  useWorkspacePreferencesStore,
} from "@/stores/workspace-preferences.store.ts";

interface WorkspacePreferencesSnapshot {
  panelCloseFocusPolicy: "adjacent" | "recent";
}
type PreferencesChangedCallback = (next: WorkspacePreferencesSnapshot) => void;

describe("useWorkspacePreferencesStore", () => {
  let changedCallback: PreferencesChangedCallback | null;
  const detachMock = vi.fn();
  const readMock = vi.fn<() => Promise<WorkspacePreferencesSnapshot>>();
  const updateMock =
    vi.fn<
      (patch: {
        panelCloseFocusPolicy?: "adjacent" | "recent";
      }) => Promise<WorkspacePreferencesSnapshot>
    >();

  beforeEach(() => {
    changedCallback = null;
    detachWorkspacePreferencesListener();
    detachMock.mockReset();
    readMock.mockReset();
    updateMock.mockReset();
    useWorkspacePreferencesStore.setState({
      panelCloseFocusPolicy: "adjacent",
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
    detachWorkspacePreferencesListener();
    vi.unstubAllGlobals();
  });

  it("defaults to adjacent before IPC hydration", () => {
    expect(
      useWorkspacePreferencesStore.getInitialState().panelCloseFocusPolicy
    ).toBe("adjacent");
  });

  it("initWorkspacePreferences hydrates policy and attaches one broadcast listener", async () => {
    readMock.mockResolvedValue({
      panelCloseFocusPolicy: "recent",
    });

    await initWorkspacePreferences();

    expect(readMock).toHaveBeenCalledTimes(1);
    expect(useWorkspacePreferencesStore.getState().panelCloseFocusPolicy).toBe(
      "recent"
    );
    expect(changedCallback).not.toBeNull();
  });

  it("setPanelCloseFocusPolicy writes the patch and hydrates from the merge", async () => {
    updateMock.mockResolvedValue({
      panelCloseFocusPolicy: "recent",
    });

    await useWorkspacePreferencesStore
      .getState()
      .setPanelCloseFocusPolicy("recent");

    expect(updateMock).toHaveBeenCalledWith({
      panelCloseFocusPolicy: "recent",
    });
    expect(useWorkspacePreferencesStore.getState().panelCloseFocusPolicy).toBe(
      "recent"
    );
  });

  it("preferences.onChanged rehydrates panel close focus policy", async () => {
    readMock.mockResolvedValue({
      panelCloseFocusPolicy: "adjacent",
    });
    await initWorkspacePreferences();

    changedCallback?.({
      panelCloseFocusPolicy: "recent",
    });

    expect(useWorkspacePreferencesStore.getState().panelCloseFocusPolicy).toBe(
      "recent"
    );
  });
});
