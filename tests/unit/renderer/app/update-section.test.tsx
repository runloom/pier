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
import { useAppUpdateStore } from "@/stores/app-update.store.ts";
import { useAppUpdatePreferencesStore } from "@/stores/app-update-preferences.store.ts";

describe("AppUpdateSection", () => {
  beforeEach(async () => {
    await initI18n();
    useAppUpdateStore.getState().reset();
    useAppUpdatePreferencesStore.setState({ receiveCandidateUpdates: false });
  });

  afterEach(() => {
    cleanup();
    useAppUpdateStore.getState().reset();
    useAppUpdatePreferencesStore.setState({ receiveCandidateUpdates: false });
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

  it("persists the candidate opt-in and re-checks on enable", async () => {
    const check = vi.fn(async () => ({
      currentVersion: "0.1.0",
      state: "not-available" as const,
    }));
    const update = vi.fn(async (patch: Record<string, unknown>) => ({
      receiveCandidateUpdates: Boolean(patch.receiveCandidateUpdates),
    }));
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
        preferences: {
          onChanged: vi.fn(() => () => {}),
          read: vi.fn(async () => ({ receiveCandidateUpdates: false })),
          update,
        },
      },
    });
    useAppUpdateStore.setState({
      snapshot: { currentVersion: "0.1.0", state: "idle" },
    });

    render(<AppUpdateSection />);
    fireEvent.click(
      await screen.findByRole("switch", { name: "Receive release candidates" })
    );

    await waitFor(() => {
      expect(update).toHaveBeenCalledWith({ receiveCandidateUpdates: true });
    });
    await waitFor(() => {
      expect(check).toHaveBeenCalledTimes(1);
    });
    expect(
      useAppUpdatePreferencesStore.getState().receiveCandidateUpdates
    ).toBe(true);
  });

  it("renders a friendly error with next step and raw detail", async () => {
    useAppUpdateStore.setState({
      snapshot: {
        currentVersion: "0.1.0",
        errorDetail: "net::ERR_INTERNET_DISCONNECTED",
        errorKind: "offline",
        state: "error",
      },
    });

    render(<AppUpdateSection />);
    expect(
      await screen.findByText("Network connection failed")
    ).toBeInTheDocument();
    expect(
      screen.getByText("Check your network connection and try again.")
    ).toBeInTheDocument();
    expect(
      screen.getByText("net::ERR_INTERNET_DISCONNECTED")
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Download" })).toBeEnabled();
    expect(
      screen.getByRole("button", { name: "Check for Updates" })
    ).toBeEnabled();
  });
});
