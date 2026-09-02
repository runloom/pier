import { DEFAULT_LSP_POLICY_PREFS } from "@shared/contracts/lsp.ts";
import type { LspCatalogStatusRow } from "@shared/contracts/lsp-provider.ts";
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

const CATALOG_ROWS: LspCatalogStatusRow[] = [
  {
    binaryHint: "bundled",
    displayName: "TypeScript / JavaScript",
    extensions: [".ts"],
    id: "typescript",
    source: "core",
    status: "bundled",
  },
  {
    binaryHint: "gopls",
    displayName: "Go",
    extensions: [".go"],
    id: "gopls",
    resolvedPath: "/opt/homebrew/bin/gopls",
    source: "core",
    status: "available",
    version: "golang.org/x/tools/gopls v0.16.1",
  },
  {
    binaryHint: "pyright-langserver",
    displayName: "Python",
    extensions: [".py"],
    id: "python",
    installCommand: "npm i -g pyright",
    source: "core",
    status: "missing",
  },
];

describe("LspSettingsCard", () => {
  const updateMock = vi.fn();
  const catalogStatusMock = vi.fn();
  const clipboardWriteMock = vi.fn();

  beforeEach(async () => {
    await initI18n();
    useLspPreferencesStore.setState(DEFAULT_LSP_POLICY_PREFS);
    updateMock.mockReset();
    catalogStatusMock.mockReset();
    clipboardWriteMock.mockReset();
    catalogStatusMock.mockResolvedValue(CATALOG_ROWS);
    clipboardWriteMock.mockResolvedValue(undefined);
    updateMock.mockImplementation(
      async (patch: Parameters<typeof makeFakePreferences>[0]) =>
        makeFakePreferences(patch)
    );
    Object.defineProperty(window, "pier", {
      configurable: true,
      value: {
        clipboard: {
          writeText: clipboardWriteMock,
        },
        lsp: {
          catalogStatus: catalogStatusMock,
        },
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

  it("enables run-in-worktrees by default", () => {
    render(<LspSettingsCard />);
    expect(
      screen.getByRole("switch", { name: "Run in worktrees" })
    ).toHaveAttribute("aria-checked", "true");
  });

  it("renders language servers as a vertical inventory in catalog order", async () => {
    render(<LspSettingsCard />);

    const list = await screen.findByTestId("lsp-tools-status-list");
    expect(list.getAttribute("data-layout")).toBeNull();
    expect(list.querySelector('[data-slot="badge"]')).toBeNull();
    expect(list.textContent).toMatch(/TypeScript[\s\S]*Go[\s\S]*Python/u);
    expect(screen.getByText("npm i -g pyright")).toBeTruthy();
    expect(screen.getByText("Install")).toBeTruthy();
    expect(screen.getByText("gopls v0.16.1")).toBeTruthy();
    expect(screen.getByText("Not installed")).toBeTruthy();
    expect(screen.getByText("Installed")).toBeTruthy();
    expect(screen.getByText("Built-in")).toBeTruthy();
  });

  it("copies the install command from a missing tool row", async () => {
    render(<LspSettingsCard />);
    const copy = await screen.findByRole("button", {
      name: "Copy install command for Python",
    });
    fireEvent.click(copy);
    await waitFor(() => {
      expect(clipboardWriteMock).toHaveBeenCalledWith("npm i -g pyright");
    });
    expect(screen.getByRole("button", { name: "Copied" })).toBeTruthy();
  });

  it("shows a failed state when the local-tools probe rejects", async () => {
    catalogStatusMock.mockRejectedValue(new Error("probe failed"));
    render(<LspSettingsCard />);

    await waitFor(() => {
      expect(screen.getByTestId("lsp-tools-status-failed")).toBeTruthy();
    });
    expect(screen.getByText("Couldn't check language servers")).toBeTruthy();
    expect(
      screen.getByText(
        "Try again in a moment, or restart Pier and reopen this page."
      )
    ).toBeTruthy();
  });

  it("shows a distinct empty state when the catalog is empty", async () => {
    catalogStatusMock.mockResolvedValue([]);
    render(<LspSettingsCard />);

    await waitFor(() => {
      expect(screen.getByTestId("lsp-tools-status-empty")).toBeTruthy();
    });
    expect(screen.getByText("No language servers to list")).toBeTruthy();
    expect(screen.getByText("Nothing to check right now.")).toBeTruthy();
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
