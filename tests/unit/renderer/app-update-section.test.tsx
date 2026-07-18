import type { AppUpdateSnapshot } from "@shared/contracts/app-update.ts";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { initI18n } from "@/i18n/index.ts";
import { AppUpdateSection } from "@/pages/settings/components/app-update-section.tsx";
import {
  __resetAppUpdateReadyToastForTests,
  useAppUpdateStore,
} from "@/stores/app-update.store.ts";

describe("AppUpdateSection", () => {
  beforeEach(async () => {
    await initI18n();
    __resetAppUpdateReadyToastForTests();
    useAppUpdateStore.getState().reset();
  });

  afterEach(() => {
    cleanup();
    useAppUpdateStore.getState().reset();
    __resetAppUpdateReadyToastForTests();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("checks for updates and renders the available version", async () => {
    const available: AppUpdateSnapshot = {
      availableVersion: "0.2.0",
      currentVersion: "0.1.0",
      state: "available",
    };
    const check = vi.fn(async () => available);
    Object.defineProperty(window, "pier", {
      configurable: true,
      value: {
        appUpdate: {
          check,
          download: vi.fn(),
          onChanged: vi.fn(() => () => {}),
          quitAndInstall: vi.fn(),
          status: vi.fn(async () => ({
            currentVersion: "0.1.0",
            state: "idle",
          })),
        },
      },
    });
    useAppUpdateStore.setState({
      snapshot: { currentVersion: "0.1.0", state: "idle" },
    });

    render(<AppUpdateSection />);
    await screen.findByText("No update check has run yet.");
    fireEvent.click(
      await screen.findByRole("button", { name: "Check for Updates" })
    );

    await waitFor(() => {
      expect(check).toHaveBeenCalledTimes(1);
    });
    expect(
      await screen.findByText("Version 0.2.0 is available.")
    ).toBeInTheDocument();
  });

  it("updates the visible state from the shared store", async () => {
    useAppUpdateStore.setState({
      snapshot: {
        availableVersion: "0.2.0",
        currentVersion: "0.1.0",
        state: "downloaded",
      },
    });

    render(<AppUpdateSection />);
    expect(
      await screen.findByText("Version 0.2.0 is available.")
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Restart and Install" })
    ).toBeEnabled();
  });
});
