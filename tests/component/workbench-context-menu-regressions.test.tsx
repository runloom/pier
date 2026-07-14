import type { MenuTemplate } from "@shared/contracts/menu.ts";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { type ReactNode, Suspense, startTransition } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useWorkbenchContextMenu } from "@/panel-kits/workbench/workbench-context-menu.ts";
import { WorkbenchPanel } from "@/panel-kits/workbench/workbench-panel.tsx";
import {
  installWorkbenchTestHarness,
  makeProps,
} from "./workbench-test-harness.ts";

vi.mock("sonner", () => ({
  toast: { error: vi.fn(), success: vi.fn() },
}));

const menuPopupMock = vi.fn(async (..._args: unknown[]) => ({
  actionId: null as string | null,
}));

interface ContextMenuState {
  hasWidgets: boolean;
  onAddWidget: () => void;
  onRefreshAll: () => void;
}

function ContextMenuProbe({
  children,
  onRender,
  state,
  suspend,
}: {
  children?: ReactNode;
  onRender?: () => void;
  state: ContextMenuState;
  suspend?: Promise<never>;
}) {
  const menu = useWorkbenchContextMenu(state);
  onRender?.();
  if (suspend) throw suspend;
  return (
    // biome-ignore lint/a11y/noNoninteractiveElementInteractions: mirrors the grid event boundary
    <section
      aria-label="Context menu probe"
      data-testid="context-menu-probe"
      onContextMenu={menu.onContextMenu}
      onKeyDown={menu.onKeyDown}
      // biome-ignore lint/a11y/noNoninteractiveTabindex: required for keyboard context menu
      tabIndex={0}
    >
      {children}
    </section>
  );
}

function state(input: Partial<ContextMenuState> = {}): ContextMenuState {
  return {
    hasWidgets: true,
    onAddWidget: vi.fn(),
    onRefreshAll: vi.fn(),
    ...input,
  };
}

function templateAt(index: number): MenuTemplate {
  return menuPopupMock.mock.calls[index]?.[0] as MenuTemplate;
}

installWorkbenchTestHarness();

beforeEach(() => {
  menuPopupMock.mockReset();
  menuPopupMock.mockResolvedValue({ actionId: null });
  vi.stubGlobal("pier", {
    ...window.pier,
    menu: { popup: menuPopupMock },
  });
});

afterEach(() => vi.unstubAllGlobals());

describe("Workbench native menu event boundaries", () => {
  it("right-clicking the widget menu opens only its Radix menu", async () => {
    render(
      <WorkbenchPanel
        {...makeProps({
          layoutVersion: 3,
          widgets: [{ h: 3, id: "core.activity-overview", w: 4 }],
        })}
      />
    );

    const trigger = screen.getByTestId("workbench-widget-menu-trigger");
    await vi.waitFor(() => expect(trigger).toBeVisible());
    fireEvent.pointerDown(trigger, {
      button: 0,
      ctrlKey: false,
      pointerType: "mouse",
    });
    fireEvent.contextMenu(trigger);

    expect(menuPopupMock).not.toHaveBeenCalled();
    expect(
      await screen.findByTestId("workbench-widget-menu-remove")
    ).toBeVisible();
  });

  it.each([
    ["ContextMenu", { key: "ContextMenu" }],
    ["Shift+F10", { key: "F10", shiftKey: true }],
  ])("ignores bubbled %s from an interactive descendant", (_name, event) => {
    render(
      <ContextMenuProbe state={state()}>
        <button type="button">Child</button>
      </ContextMenuProbe>
    );

    fireEvent.keyDown(screen.getByRole("button", { name: "Child" }), event);

    expect(menuPopupMock).not.toHaveBeenCalled();
  });
});

describe("useWorkbenchContextMenu concurrent render isolation", () => {
  it("dispatches through the last committed state", async () => {
    const refreshA = vi.fn();
    const refreshB = vi.fn();
    const stateA = state({ hasWidgets: true, onRefreshAll: refreshA });
    const stateB = state({ hasWidgets: false, onRefreshAll: refreshB });
    const neverCommits = new Promise<never>(() => undefined);
    const view = render(
      <Suspense fallback={null}>
        <ContextMenuProbe state={stateA} />
      </Suspense>
    );

    act(() => {
      startTransition(() => {
        view.rerender(
          <Suspense fallback={null}>
            <ContextMenuProbe state={stateB} suspend={neverCommits} />
          </Suspense>
        );
      });
    });
    menuPopupMock.mockResolvedValueOnce({
      actionId: "pier.workbench.refreshAll",
    });
    fireEvent.contextMenu(screen.getByTestId("context-menu-probe"));

    await vi.waitFor(() => expect(refreshA).toHaveBeenCalledTimes(1));
    expect(refreshB).not.toHaveBeenCalled();
    expect(templateAt(0)[1]).toMatchObject({ enabled: true });
  });
});
