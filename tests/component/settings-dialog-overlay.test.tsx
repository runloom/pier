import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { initI18n } from "@/i18n/index.ts";
import { SettingsDialog } from "@/pages/settings/settings-dialog.tsx";
import { useSettingsDialogStore } from "@/stores/settings-dialog.store.ts";

const BACKDROP_FILTER_CLASS = /backdrop-blur|backdrop-filter/;

describe("SettingsDialog overlay", () => {
  beforeAll(async () => {
    await initI18n();
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    useSettingsDialogStore.setState({ isOpen: false });
  });

  it("keeps the default settings backdrop without hiding native terminal surfaces", () => {
    const setOverlayActive = vi.fn();
    vi.stubGlobal("matchMedia", () => ({
      addEventListener: vi.fn(),
      matches: false,
      removeEventListener: vi.fn(),
    }));
    Object.defineProperty(window, "pier", {
      configurable: true,
      value: { terminal: { setOverlayActive } },
    });
    useSettingsDialogStore.setState({ isOpen: true });

    render(<SettingsDialog />);

    const overlay = document.querySelector('[data-slot="dialog-overlay"]');

    expect(overlay).toBeInstanceOf(HTMLElement);
    expect(overlay?.className).toContain("bg-overlay-scrim");
    expect(overlay?.className).toContain("top-[var(--app-titlebar-height)]");
    expect(overlay?.className).not.toContain("inset-0");
    expect(overlay?.className).not.toContain("bg-black/30");
    expect(overlay?.className).not.toMatch(BACKDROP_FILTER_CLASS);
    expect(setOverlayActive).toHaveBeenCalledWith(true);
  });

  it("does not autofocus the first settings navigation item on open", () => {
    vi.stubGlobal("matchMedia", () => ({
      addEventListener: vi.fn(),
      matches: false,
      removeEventListener: vi.fn(),
    }));
    Object.defineProperty(window, "pier", {
      configurable: true,
      value: { terminal: { setOverlayActive: vi.fn() } },
    });
    useSettingsDialogStore.setState({ isOpen: true });

    render(<SettingsDialog />);

    const content = document.querySelector('[data-slot="dialog-content"]');
    const appearanceNav = screen.getByRole("button", { name: "Appearance" });

    expect(content).toBeInstanceOf(HTMLElement);
    expect(content).toHaveAttribute("tabindex", "-1");
    expect(document.activeElement).toBe(content);
    expect(document.activeElement).not.toBe(appearanceNav);
    expect(appearanceNav).toHaveAttribute("aria-current", "page");
  });

  it("opens when main requests the settings dialog", async () => {
    let openRequest: (() => void) | undefined;
    vi.stubGlobal("matchMedia", () => ({
      addEventListener: vi.fn(),
      matches: false,
      removeEventListener: vi.fn(),
    }));
    Object.defineProperty(window, "pier", {
      configurable: true,
      value: {
        settings: {
          onOpenRequest: vi.fn((cb: () => void) => {
            openRequest = cb;
            return vi.fn();
          }),
        },
        terminal: { setOverlayActive: vi.fn() },
      },
    });

    render(<SettingsDialog />);

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    act(() => {
      openRequest?.();
    });
    expect(await screen.findByRole("dialog")).toBeInTheDocument();
  });
});
