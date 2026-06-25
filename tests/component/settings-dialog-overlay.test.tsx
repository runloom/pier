import { cleanup, render, screen } from "@testing-library/react";
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
    const appearanceNav = screen.getByRole("button", { name: "外观" });

    expect(content).toBeInstanceOf(HTMLElement);
    expect(content).toHaveAttribute("tabindex", "-1");
    expect(document.activeElement).toBe(content);
    expect(document.activeElement).not.toBe(appearanceNav);
    expect(appearanceNav).toHaveAttribute("aria-current", "page");
  });
});
