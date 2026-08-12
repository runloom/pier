import { DEFAULT_LSP_POLICY_PREFS } from "@shared/contracts/lsp.ts";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { initI18n } from "@/i18n/index.ts";
import { LspSettingsCard } from "@/pages/settings/components/lsp-settings-card.tsx";
import { useLspPreferencesStore } from "@/stores/lsp-preferences.store.ts";
import { makeFakePreferences } from "../../../setup/preferences-fixture.ts";

describe("LspSettingsCard", () => {
  const updateMock = vi.fn();

  beforeEach(async () => {
    await initI18n();
    useLspPreferencesStore.setState(DEFAULT_LSP_POLICY_PREFS);
    updateMock.mockReset();
    updateMock.mockImplementation(
      async (patch: Parameters<typeof makeFakePreferences>[0]) =>
        makeFakePreferences(patch)
    );
    Object.defineProperty(window, "pier", {
      configurable: true,
      value: {
        preferences: {
          update: updateMock,
        },
      },
    });
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    useLspPreferencesStore.setState(DEFAULT_LSP_POLICY_PREFS);
  });

  it("edits the idle release timeout in minutes and persists milliseconds", async () => {
    render(<LspSettingsCard />);

    const input = screen.getByRole("spinbutton", {
      name: "Idle release",
    });
    expect(input).toHaveValue(30);
    expect(screen.getByText("min")).toBeTruthy();

    fireEvent.change(input, { target: { value: "45" } });
    fireEvent.blur(input);

    await waitFor(() => {
      expect(updateMock).toHaveBeenCalledWith({
        lsp: {
          ...DEFAULT_LSP_POLICY_PREFS,
          idleReleaseMs: 2_700_000,
        },
      });
    });
    expect(useLspPreferencesStore.getState().idleReleaseMs).toBe(2_700_000);
  });
});
