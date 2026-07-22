import { act, fireEvent, render, screen } from "@testing-library/react";
import { Copy, RefreshCw, Trash2 } from "lucide-react";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { initI18n } from "@/i18n/index.ts";
import {
  type WidgetHeaderAction,
  WorkbenchWidgetActions,
} from "@/panel-kits/workbench/workbench-widget-actions.tsx";

class TestResizeObserver implements ResizeObserver {
  static instances: TestResizeObserver[] = [];
  readonly disconnect = vi.fn();
  readonly observe = vi.fn();
  readonly unobserve = vi.fn();
  private readonly callback: ResizeObserverCallback;

  constructor(callback: ResizeObserverCallback) {
    this.callback = callback;
    TestResizeObserver.instances.push(this);
  }

  emit(target: Element): void {
    this.callback([{ target } as ResizeObserverEntry], this);
  }
}

function forceAllActionsVisible(container: HTMLElement): void {
  const root = container.querySelector(
    '[data-slot="workbench-widget-actions"]'
  );
  expect(root).not.toBeNull();
  // Measurement uses card-header clientWidth with a large chrome reserve.
  Object.defineProperty(root, "clientWidth", {
    configurable: true,
    value: 640,
  });
  for (const button of root!.querySelectorAll(
    "[data-measure-action], [data-measure-more]"
  )) {
    const width = 28;
    vi.spyOn(button, "getBoundingClientRect").mockReturnValue({
      bottom: width,
      height: width,
      left: 0,
      right: width,
      toJSON: () => ({}),
      top: 0,
      width,
      x: 0,
      y: 0,
    } as DOMRect);
  }
  for (const observer of TestResizeObserver.instances) {
    observer.emit(root as Element);
  }
}

function renderActions(actions: readonly WidgetHeaderAction[]): void {
  TestResizeObserver.instances = [];
  const { container } = render(<WorkbenchWidgetActions actions={actions} />);
  act(() => {
    forceAllActionsVisible(container);
  });
}

beforeAll(async () => {
  await initI18n();
});

beforeEach(() => {
  TestResizeObserver.instances = [];
  vi.stubGlobal("ResizeObserver", TestResizeObserver);
  vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
    cb(0);
    return 0;
  });
  vi.stubGlobal("cancelAnimationFrame", vi.fn());
});

describe("WorkbenchWidgetActions pending spin", () => {
  it("spins refresh icons while pending but keeps remove icons still", async () => {
    let resolveRefresh: (() => void) | undefined;
    let resolveRemove: (() => void) | undefined;
    const refresh = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolveRefresh = resolve;
        })
    );
    const remove = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolveRemove = resolve;
        })
    );

    renderActions([
      {
        icon: RefreshCw,
        id: "host:refresh",
        invoke: refresh,
        label: "Refresh",
        priority: 50,
        testId: "action-refresh",
      },
      {
        icon: Copy,
        id: "host:duplicate",
        invoke: vi.fn(async () => undefined),
        label: "Duplicate",
        priority: 20,
        testId: "action-duplicate",
      },
      {
        icon: Trash2,
        id: "host:remove",
        intent: "destructive",
        invoke: remove,
        label: "Remove",
        priority: 10,
        testId: "action-remove",
      },
    ]);

    const refreshButton = await screen.findByTestId("action-refresh");
    const removeButton = await screen.findByTestId("action-remove");

    fireEvent.click(refreshButton);
    expect(refreshButton.querySelector("svg")).toHaveClass("animate-spin");
    expect(removeButton.querySelector("svg")).not.toHaveClass("animate-spin");

    await act(async () => {
      resolveRefresh?.();
    });

    fireEvent.click(removeButton);
    expect(removeButton).toHaveAttribute("aria-busy", "true");
    expect(removeButton.querySelector("svg")).not.toHaveClass("animate-spin");

    await act(async () => {
      resolveRemove?.();
    });
  });
});
