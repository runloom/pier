import type { AppUpdateSnapshot } from "@shared/contracts/app-update.ts";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { initI18n } from "@/i18n/index.ts";
import { AppUpdateSection } from "@/pages/settings/components/app-update-section.tsx";

describe("AppUpdateSection", () => {
  beforeEach(async () => {
    await initI18n();
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("checks for updates and renders the available version", async () => {
    const idle: AppUpdateSnapshot = {
      currentVersion: "0.1.0",
      state: "idle",
    };
    const available: AppUpdateSnapshot = {
      availableVersion: "0.2.0",
      currentVersion: "0.1.0",
      state: "available",
    };
    const check = vi.fn(async () => available);
    const onChanged = vi.fn(() => () => {});
    Object.defineProperty(window, "pier", {
      configurable: true,
      value: {
        appUpdate: {
          check,
          download: vi.fn(),
          onChanged,
          quitAndInstall: vi.fn(),
          status: vi.fn(async () => idle),
        },
      },
    });

    render(<AppUpdateSection />);
    await screen.findByText("No update check has run yet.");
    fireEvent.click(
      await screen.findByRole("button", { name: "Check for Updates" })
    );

    await waitFor(() => {
      expect(check).toHaveBeenCalledTimes(1);
    });
    expect(onChanged).toHaveBeenCalledTimes(1);
    expect(
      await screen.findByText("Version 0.2.0 is available.")
    ).toBeInTheDocument();
  });

  it("updates the visible state from update broadcasts", async () => {
    const idle: AppUpdateSnapshot = {
      currentVersion: "0.1.0",
      state: "idle",
    };
    const downloaded: AppUpdateSnapshot = {
      availableVersion: "0.2.0",
      currentVersion: "0.1.0",
      state: "downloaded",
    };
    let listener: ((snapshot: AppUpdateSnapshot) => void) | null = null;
    Object.defineProperty(window, "pier", {
      configurable: true,
      value: {
        appUpdate: {
          check: vi.fn(),
          download: vi.fn(),
          onChanged: vi.fn((cb: (snapshot: AppUpdateSnapshot) => void) => {
            listener = cb;
            return () => {
              listener = null;
            };
          }),
          quitAndInstall: vi.fn(),
          status: vi.fn(async () => idle),
        },
      },
    });

    render(<AppUpdateSection />);
    await screen.findByText("No update check has run yet.");
    act(() => {
      listener?.(downloaded);
    });

    expect(
      await screen.findByText("Version 0.2.0 is available.")
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Restart and Install" })
    ).toBeEnabled();
  });
});
