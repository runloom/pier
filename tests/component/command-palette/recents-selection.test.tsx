import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CommandPalette } from "@/components/common/command-palette/index.tsx";
import { initI18n } from "@/i18n/index.ts";
import { actionRegistry } from "@/lib/actions/registry.ts";
import { useCommandPaletteController } from "@/lib/command-palette/controller.ts";
import { resetAppDialogForTests } from "@/stores/app-dialog.store.ts";
import { useCommandPaletteMru } from "@/stores/command-palette-mru.store.ts";

class TestResizeObserver {
  observe = vi.fn();
  unobserve = vi.fn();
  disconnect = vi.fn();
}

function selectedItems(): HTMLElement[] {
  return Array.from(
    document.querySelectorAll<HTMLElement>('[cmdk-item][aria-selected="true"]')
  );
}

describe("CommandPalette recents selection", () => {
  beforeEach(async () => {
    await initI18n();
    vi.stubGlobal("ResizeObserver", TestResizeObserver);
    Element.prototype.scrollIntoView = vi.fn();
    resetAppDialogForTests();
    actionRegistry.clearForTests();
    useCommandPaletteMru.setState({
      entries: [],
      frecencyMap: new Map(),
    });
    useCommandPaletteController.setState({
      mode: "commands",
      open: false,
      quickPick: null,
      requestId: 0,
      stack: [],
    });
    Object.defineProperty(window, "pier", {
      configurable: true,
      value: {
        terminal: {
          applyHostSnapshot: vi.fn(),
        },
      },
    });
  });

  afterEach(() => {
    actionRegistry.clearForTests();
    useCommandPaletteMru.setState({
      entries: [],
      frecencyMap: new Map(),
    });
    useCommandPaletteController.setState({
      mode: "commands",
      open: false,
      quickPick: null,
      requestId: 0,
      stack: [],
    });
    vi.restoreAllMocks();
    resetAppDialogForTests();
    Element.prototype.scrollIntoView = HTMLElement.prototype.scrollIntoView;
  });

  it("keeps recents and catalog copies independently selectable", async () => {
    actionRegistry.register({
      category: "view",
      handler: vi.fn(),
      id: "pier.view.zoomIn",
      metadata: { categoryKey: "view", sortOrder: 1 },
      surfaces: ["command-palette"],
      title: () => "Zoom In",
    });
    actionRegistry.register({
      category: "view",
      handler: vi.fn(),
      id: "pier.view.zoomOut",
      metadata: { categoryKey: "view", sortOrder: 2 },
      surfaces: ["command-palette"],
      title: () => "Zoom Out",
    });
    useCommandPaletteMru.setState({
      entries: [
        {
          actionId: "pier.view.zoomIn",
          lastUsedAt: Date.now(),
          useCount: 4,
        },
      ],
      frecencyMap: new Map([["pier.view.zoomIn", 4]]),
    });

    render(<CommandPalette />);
    act(() => {
      useCommandPaletteController.getState().openPalette();
    });

    await waitFor(() => {
      expect(screen.getAllByText("Zoom In")).toHaveLength(2);
    });
    const zoomInRows = screen
      .getAllByText("Zoom In")
      .map((node) => node.closest("[cmdk-item]"));
    expect(selectedItems()).toHaveLength(1);
    expect(zoomInRows[0]).toHaveAttribute("aria-selected", "true");
    expect(zoomInRows[1]).not.toHaveAttribute("aria-selected", "true");

    const input = document.querySelector("[cmdk-input]");
    expect(input).toBeTruthy();
    fireEvent.keyDown(input as HTMLElement, { key: "ArrowDown" });

    await waitFor(() => {
      expect(selectedItems()).toHaveLength(1);
      expect(zoomInRows[1]).toHaveAttribute("aria-selected", "true");
    });

    fireEvent.keyDown(input as HTMLElement, { key: "ArrowDown" });

    await waitFor(() => {
      expect(selectedItems()).toHaveLength(1);
      expect(
        screen.getByText("Zoom Out").closest("[cmdk-item]")
      ).toHaveAttribute("aria-selected", "true");
    });
  });
});
