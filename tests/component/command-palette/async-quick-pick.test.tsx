import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import i18next from "i18next";
import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CommandPalette } from "@/components/common/command-palette/index.tsx";
import { initI18n } from "@/i18n/index.ts";
import { useCommandPaletteController } from "@/lib/command-palette/controller.ts";
import { resetAppDialogForTests } from "@/stores/app-dialog.store.ts";

class TestResizeObserver {
  observe = vi.fn();
  unobserve = vi.fn();
  disconnect = vi.fn();
}

const originalScrollIntoView = Element.prototype.scrollIntoView;

describe("CommandPalette async quick pick", () => {
  beforeEach(async () => {
    await initI18n();
    await i18next.changeLanguage("en");
    vi.stubGlobal("ResizeObserver", TestResizeObserver);
    Element.prototype.scrollIntoView = vi.fn();
    resetAppDialogForTests();
    useCommandPaletteController.setState({
      mode: "commands",
      open: false,
      quickPick: null,
      requestId: 0,
      stack: [],
    });
    Object.defineProperty(window, "pier", {
      configurable: true,
      value: { terminal: { applyHostSnapshot: vi.fn() } },
    });
  });

  afterEach(() => {
    Element.prototype.scrollIntoView = originalScrollIntoView;
    vi.unstubAllGlobals();
    useCommandPaletteController.setState({
      mode: "commands",
      open: false,
      quickPick: null,
      requestId: 0,
      stack: [],
    });
  });

  it("fires onQueryChange on open and on each keystroke, aborting the previous signal", async () => {
    const onQueryChange = vi.fn<(query: string, signal: AbortSignal) => void>();
    render(<CommandPalette />);

    act(() => {
      useCommandPaletteController.getState().openQuickPick({
        items: [],
        loading: true,
        onAccept: vi.fn(),
        onQueryChange,
        placeholder: "Search things",
        title: "Async pick",
      });
    });

    await waitFor(() => {
      expect(onQueryChange).toHaveBeenCalled();
    });
    const firstCall = onQueryChange.mock.calls[0];
    if (!firstCall) {
      throw new Error("expected onQueryChange to be invoked on open");
    }
    expect(firstCall[0]).toBe("");
    expect(firstCall[1]).toBeInstanceOf(AbortSignal);
    expect(firstCall[1].aborted).toBe(false);
    onQueryChange.mockClear();

    const input = await screen.findByPlaceholderText("Search things");
    fireEvent.change(input, { target: { value: "a" } });

    await waitFor(() => {
      expect(onQueryChange).toHaveBeenCalledWith("a", expect.any(AbortSignal));
    });
    // Previous signal must be aborted before/when the next call fires.
    expect(firstCall[1].aborted).toBe(true);
    const secondSignal = onQueryChange.mock.calls[0]?.[1];
    expect(secondSignal?.aborted).toBe(false);
    onQueryChange.mockClear();

    fireEvent.change(input, { target: { value: "ab" } });
    await waitFor(() => {
      expect(onQueryChange).toHaveBeenCalledWith("ab", expect.any(AbortSignal));
    });
    expect(secondSignal?.aborted).toBe(true);
  });

  it("aborts the pending onQueryChange signal when the palette closes", async () => {
    const onQueryChange = vi.fn<(query: string, signal: AbortSignal) => void>();
    render(<CommandPalette />);

    act(() => {
      useCommandPaletteController.getState().openQuickPick({
        items: [],
        onAccept: vi.fn(),
        onQueryChange,
        placeholder: "Search things",
        title: "Async pick",
      });
    });
    await waitFor(() => {
      expect(onQueryChange).toHaveBeenCalled();
    });
    const signal = onQueryChange.mock.calls[0]?.[1];
    expect(signal?.aborted).toBe(false);

    act(() => {
      useCommandPaletteController.getState().close();
    });

    expect(signal?.aborted).toBe(true);
  });

  it("renders errorText and preserves input focus when updated via updateQuickPick", async () => {
    render(<CommandPalette />);

    act(() => {
      useCommandPaletteController.getState().openQuickPick({
        items: [],
        loading: true,
        onAccept: vi.fn(),
        placeholder: "Search things",
        title: "Async pick",
      });
    });

    const input = await screen.findByPlaceholderText("Search things");
    fireEvent.change(input, { target: { value: "boom" } });
    // Focus the input the way a user would after typing.
    (input as HTMLInputElement).focus();
    expect(document.activeElement).toBe(input);

    act(() => {
      useCommandPaletteController.getState().updateQuickPick({
        errorText: "Search failed: boom",
        loading: false,
      });
    });

    await waitFor(() => {
      expect(screen.getByText("Search failed: boom")).toBeVisible();
    });
    expect(input).toHaveValue("boom");
    expect(document.activeElement).toBe(input);
    // Session identity preserved (no requestId bump, no stack push).
    const state = useCommandPaletteController.getState();
    expect(state.requestId).toBe(1);
    expect(state.stack).toHaveLength(0);
    expect(state.quickPick?.errorText).toBe("Search failed: boom");
    expect(state.quickPick?.loading).toBe(false);
  });

  it("shows a loading skeleton instead of empty copy while async items are pending", async () => {
    render(<CommandPalette />);

    act(() => {
      useCommandPaletteController.getState().openQuickPick({
        items: [],
        loading: true,
        onAccept: vi.fn(),
        placeholder: "Search things",
        title: "Async pick",
      });
    });

    await screen.findByPlaceholderText("Search things");
    expect(
      document.querySelector('[data-slot="command-palette-loading"]')
    ).not.toBeNull();
    expect(
      screen.getByRole("status", {
        name: i18next.t("commandPalette.loading"),
      })
    ).toBeVisible();
    expect(
      screen.queryByText(i18next.t("commandPalette.emptyQuickPick"))
    ).toBeNull();

    act(() => {
      useCommandPaletteController.getState().updateQuickPick({
        items: [
          {
            id: "result-1",
            label: "Result One",
          },
        ],
        loading: false,
      });
    });

    await waitFor(() => {
      expect(screen.getByText("Result One")).toBeVisible();
    });
    expect(
      document.querySelector('[data-slot="command-palette-loading"]')
    ).toBeNull();
    expect(
      screen.queryByText(i18next.t("commandPalette.emptyQuickPick"))
    ).toBeNull();
  });

  it("shows empty copy only after loading finishes with no results", async () => {
    render(<CommandPalette />);

    act(() => {
      useCommandPaletteController.getState().openQuickPick({
        items: [],
        loading: true,
        onAccept: vi.fn(),
        placeholder: "Search things",
        title: "Async pick",
      });
    });

    await screen.findByPlaceholderText("Search things");
    expect(
      screen.queryByText(i18next.t("commandPalette.emptyQuickPick"))
    ).toBeNull();

    act(() => {
      useCommandPaletteController.getState().updateQuickPick({
        items: [],
        loading: false,
      });
    });

    await waitFor(() => {
      expect(
        screen.getByText(i18next.t("commandPalette.emptyQuickPick"))
      ).toBeVisible();
    });
    expect(
      document.querySelector('[data-slot="command-palette-loading"]')
    ).toBeNull();
  });
});
