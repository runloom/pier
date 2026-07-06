import type { AppQuitConfirmationMode } from "@shared/contracts/preferences.ts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  detachAppQuitPreferencesListener,
  initAppQuitPreferences,
  useAppQuitPreferencesStore,
} from "@/stores/app-quit-preferences.store.ts";

interface AppQuitPreferenceSnapshot {
  confirmOnQuit: AppQuitConfirmationMode;
}

type PreferencesChangedCallback = (next: AppQuitPreferenceSnapshot) => void;

describe("useAppQuitPreferencesStore", () => {
  let changedCallback: PreferencesChangedCallback | null;
  const detachMock = vi.fn();
  const readMock = vi.fn<() => Promise<AppQuitPreferenceSnapshot>>();
  const updateMock =
    vi.fn<
      (patch: {
        confirmOnQuit?: AppQuitConfirmationMode;
      }) => Promise<AppQuitPreferenceSnapshot>
    >();

  beforeEach(() => {
    changedCallback = null;
    detachAppQuitPreferencesListener();
    detachMock.mockReset();
    readMock.mockReset();
    updateMock.mockReset();
    useAppQuitPreferencesStore.setState({
      confirmOnQuit: "hasActivity",
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
    detachAppQuitPreferencesListener();
    vi.unstubAllGlobals();
  });

  it("initAppQuitPreferences hydrates confirmOnQuit from preferences.read", async () => {
    readMock.mockResolvedValue({
      confirmOnQuit: "never",
    });

    await initAppQuitPreferences();

    expect(readMock).toHaveBeenCalledTimes(1);
    expect(useAppQuitPreferencesStore.getState().confirmOnQuit).toBe("never");
    expect(changedCallback).not.toBeNull();
  });

  it("setConfirmOnQuit writes the selected mode and hydrates from the merged snapshot", async () => {
    updateMock.mockResolvedValue({
      confirmOnQuit: "always",
    });

    await useAppQuitPreferencesStore.getState().setConfirmOnQuit("always");

    expect(updateMock).toHaveBeenCalledWith({
      confirmOnQuit: "always",
    });
    expect(useAppQuitPreferencesStore.getState().confirmOnQuit).toBe("always");
  });

  it("preferences.onChanged broadcasts synchronize confirmOnQuit", async () => {
    readMock.mockResolvedValue({
      confirmOnQuit: "hasActivity",
    });
    await initAppQuitPreferences();

    changedCallback?.({
      confirmOnQuit: "always",
    });

    expect(useAppQuitPreferencesStore.getState().confirmOnQuit).toBe("always");
  });
});
