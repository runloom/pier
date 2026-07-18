import type { AppUpdateSnapshot } from "@shared/contracts/app-update.ts";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AppUpdateControl } from "@/components/common/app-update-control.tsx";
import { initI18n } from "@/i18n/index.ts";
import {
  __resetAppUpdateReadyToastForTests,
  useAppUpdateStore,
} from "@/stores/app-update.store.ts";
import { useSettingsDialogStore } from "@/stores/settings-dialog.store.ts";

describe("AppUpdateControl", () => {
  beforeEach(async () => {
    await initI18n();
    __resetAppUpdateReadyToastForTests();
    useAppUpdateStore.getState().reset();
    useSettingsDialogStore.setState({
      activeSection: "appearance",
      isOpen: false,
    });
  });

  afterEach(() => {
    cleanup();
    useAppUpdateStore.getState().reset();
    __resetAppUpdateReadyToastForTests();
    vi.restoreAllMocks();
  });

  it("hides when there is no update attention state", () => {
    useAppUpdateStore.setState({
      snapshot: { currentVersion: "0.1.0", state: "not-available" },
    });
    const { container } = render(<AppUpdateControl />);
    expect(container).toBeEmptyDOMElement();
  });

  it("opens settings for an available update", () => {
    const snapshot: AppUpdateSnapshot = {
      availableVersion: "0.2.0",
      currentVersion: "0.1.0",
      state: "available",
    };
    useAppUpdateStore.setState({ snapshot });
    render(<AppUpdateControl />);
    fireEvent.click(screen.getByTestId("titlebar-app-update"));
    expect(useSettingsDialogStore.getState().isOpen).toBe(true);
    expect(useSettingsDialogStore.getState().activeSection).toBe("updates");
  });

  it("restarts to install when downloaded", () => {
    const quitAndInstall = vi.fn(async () => undefined);
    useAppUpdateStore.setState({
      quitAndInstall,
      snapshot: {
        availableVersion: "0.2.0",
        currentVersion: "0.1.0",
        state: "downloaded",
      },
    });
    render(<AppUpdateControl />);
    fireEvent.click(screen.getByTestId("titlebar-app-update"));
    expect(quitAndInstall).toHaveBeenCalledTimes(1);
    expect(useSettingsDialogStore.getState().isOpen).toBe(false);
  });
});
