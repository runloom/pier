import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CommandPalette } from "@/components/common/command-palette.tsx";
import { initI18n } from "@/i18n/index.ts";
import { useCommandPaletteController } from "@/lib/command-palette/controller.ts";
import type { QuickPickItem } from "@/lib/command-palette/types.ts";
import { resetAppDialogForTests } from "@/stores/app-dialog.store.ts";

class TestResizeObserver {
  observe = vi.fn();
  unobserve = vi.fn();
  disconnect = vi.fn();
}

const originalScrollIntoView = Element.prototype.scrollIntoView;
const originalRequestAnimationFrame = window.requestAnimationFrame;
const originalCancelAnimationFrame = window.cancelAnimationFrame;
const scrollIntoViewMock = vi.fn();
let nextAnimationFrameId = 1;
let animationFrames = new Map<number, FrameRequestCallback>();

function flushAnimationFrames(): void {
  const pending = [...animationFrames.values()];
  animationFrames.clear();
  for (const callback of pending) {
    callback(performance.now());
  }
}

function makeItems(prefix: string): QuickPickItem[] {
  return Array.from({ length: 30 }, (_, index) => ({
    id: `${prefix}-${index}`,
    label: `${prefix} ${index}`,
  }));
}

function getList(): HTMLDivElement {
  const lists = document.querySelectorAll<HTMLDivElement>(
    '[data-slot="command-list"]'
  );
  if (lists.length !== 1) {
    throw new Error(`expected one command list, received ${lists.length}`);
  }
  return lists.item(0);
}

function getItem(label: string): HTMLElement {
  const item = screen.getByText(label).closest<HTMLElement>("[cmdk-item]");
  if (!item) {
    throw new Error(`expected command item for ${label}`);
  }
  return item;
}

async function waitForSelected(label: string): Promise<HTMLElement> {
  const item = getItem(label);
  await waitFor(() => {
    expect(item).toHaveAttribute("aria-selected", "true");
  });
  return item;
}

describe("CommandPalette list scrolling", () => {
  beforeEach(async () => {
    await initI18n();
    vi.stubGlobal("ResizeObserver", TestResizeObserver);
    animationFrames = new Map();
    nextAnimationFrameId = 1;
    window.requestAnimationFrame = vi.fn((callback: FrameRequestCallback) => {
      const id = nextAnimationFrameId;
      nextAnimationFrameId += 1;
      animationFrames.set(id, callback);
      return id;
    });
    window.cancelAnimationFrame = vi.fn((id: number) => {
      animationFrames.delete(id);
    });
    Element.prototype.scrollIntoView = scrollIntoViewMock;
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
      value: {
        terminal: {
          applyHostSnapshot: vi.fn(),
        },
      },
    });
  });

  afterEach(() => {
    useCommandPaletteController.setState({
      mode: "commands",
      open: false,
      quickPick: null,
      requestId: 0,
      stack: [],
    });
    vi.restoreAllMocks();
    resetAppDialogForTests();
    vi.unstubAllGlobals();
    window.requestAnimationFrame = originalRequestAnimationFrame;
    window.cancelAnimationFrame = originalCancelAnimationFrame;
    if (originalScrollIntoView) {
      Element.prototype.scrollIntoView = originalScrollIntoView;
    } else {
      Reflect.deleteProperty(Element.prototype, "scrollIntoView");
    }
  });

  it("resets the hidden list to the first match after search changes", async () => {
    const items = makeItems("Task");
    items[0] = { id: "alpha", label: "Alpha Result" };
    render(<CommandPalette />);

    act(() => {
      useCommandPaletteController.getState().openQuickPick({
        items,
        onAccept: vi.fn(),
        placeholder: "Search tasks",
        title: "Tasks",
      });
    });

    await waitForSelected("Alpha Result");
    act(flushAnimationFrames);
    const list = getList();
    list.scrollTop = 240;
    scrollIntoViewMock.mockClear();

    fireEvent.change(screen.getByPlaceholderText("Search tasks"), {
      target: { value: "alpha" },
    });
    const selected = await waitForSelected("Alpha Result");
    act(flushAnimationFrames);

    expect(list.scrollTop).toBe(0);
    expect(selected).toHaveAttribute("aria-selected", "true");
    expect(scrollIntoViewMock).toHaveBeenCalledWith({ block: "nearest" });
    expect(list).toHaveAttribute("data-scrollbar", "none");
    expect(list).toHaveClass("no-scrollbar");
  });

  it("resets and reveals the selection when a new picker session opens", async () => {
    render(<CommandPalette />);
    act(() => {
      useCommandPaletteController.getState().openQuickPick({
        items: makeItems("First"),
        onAccept: vi.fn(),
        title: "First picker",
      });
    });

    await waitForSelected("First 0");
    act(flushAnimationFrames);
    const list = getList();
    list.scrollTop = 240;
    scrollIntoViewMock.mockClear();
    const secondItems = makeItems("Second").map((item, index) => ({
      ...item,
      checked: index === 12,
    }));

    act(() => {
      useCommandPaletteController.getState().openQuickPick({
        items: secondItems,
        onAccept: vi.fn(),
        title: "Second picker",
      });
    });

    const selected = await waitForSelected("Second 12");
    act(flushAnimationFrames);
    expect(getList()).toBe(list);
    expect(list.scrollTop).toBe(0);
    expect(selected).toHaveAttribute("aria-selected", "true");
    expect(scrollIntoViewMock).toHaveBeenCalledWith({ block: "nearest" });
  });

  it("preserves scroll when an async update keeps the selected item", async () => {
    const items = makeItems("Async");
    render(<CommandPalette />);
    act(() => {
      useCommandPaletteController.getState().openQuickPick({
        items,
        onAccept: vi.fn(),
        title: "Async picker",
      });
    });

    await waitForSelected("Async 0");
    act(flushAnimationFrames);
    fireEvent.pointerMove(getItem("Async 15"), { pointerType: "mouse" });
    const selected = await waitForSelected("Async 15");
    act(flushAnimationFrames);
    const list = getList();
    list.scrollTop = 240;
    scrollIntoViewMock.mockClear();

    act(() => {
      useCommandPaletteController.getState().updateQuickPick({
        items: items.map((item) =>
          item.id === "Async-15"
            ? { ...item, detail: "Updated asynchronously" }
            : item
        ),
      });
    });

    await screen.findByText("Updated asynchronously");
    expect(selected).toHaveAttribute("aria-selected", "true");
    expect(list.scrollTop).toBe(240);
    expect(scrollIntoViewMock).not.toHaveBeenCalled();
  });

  it("reveals the fallback selection when replaced content removes the selection", async () => {
    render(<CommandPalette />);
    act(() => {
      useCommandPaletteController.getState().openQuickPick({
        items: makeItems("Original"),
        onAccept: vi.fn(),
        title: "Original picker",
      });
    });

    await waitForSelected("Original 0");
    act(flushAnimationFrames);
    fireEvent.pointerMove(getItem("Original 15"), { pointerType: "mouse" });
    await waitForSelected("Original 15");
    act(flushAnimationFrames);
    const list = getList();
    list.scrollTop = 240;
    scrollIntoViewMock.mockClear();

    act(() => {
      useCommandPaletteController.getState().replaceQuickPick({
        items: makeItems("Replacement"),
        onAccept: vi.fn(),
        title: "Replacement picker",
      });
    });

    const selected = await waitForSelected("Replacement 0");
    act(flushAnimationFrames);
    expect(selected).toHaveAttribute("aria-selected", "true");
    expect(scrollIntoViewMock).toHaveBeenCalledWith({ block: "nearest" });
  });
});
