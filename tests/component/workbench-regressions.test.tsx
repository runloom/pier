import type { WorkbenchWidgetComponentProps } from "@plugins/api/renderer.ts";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { RefreshCw } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AppDialogHost } from "@/components/common/app-dialog-host.tsx";
import { registerPluginWorkbenchWidget } from "@/lib/plugins/plugin-workbench-widget-registry.ts";
import { WorkbenchPanel } from "@/panel-kits/workbench/workbench-panel.tsx";
import {
  installWorkbenchTestHarness,
  makePluginRegistryEntry,
  makeProps,
  openPanelContextMenu,
  setPluginRegistry,
} from "./workbench-test-harness.ts";

vi.mock("sonner", () => ({
  toast: { error: vi.fn(), success: vi.fn() },
}));

const menuPopupMock = vi.fn(async (..._args: unknown[]) => ({
  actionId: null as string | null,
}));

beforeEach(() => {
  menuPopupMock.mockReset();
  menuPopupMock.mockResolvedValue({ actionId: null });
  vi.stubGlobal("pier", {
    ...window.pier,
    menu: { popup: menuPopupMock },
  });
});

afterEach(() => vi.unstubAllGlobals());

installWorkbenchTestHarness();

function DockviewEchoPanel({
  onEcho,
}: {
  onEcho: (value: Record<string, unknown>) => void;
}) {
  const [params, setParams] = useState<Record<string, unknown>>({
    layoutVersion: 3,
    widgets: [],
  });
  const paramsRef = useRef(params);
  paramsRef.current = params;
  const [baseProps] = useState(() => makeProps(params));
  const [api] = useState(() => ({
    ...baseProps.api,
    updateParameters(next: Record<string, unknown>) {
      paramsRef.current = next;
      onEcho(structuredClone(next));
      setParams(next);
    },
  }));

  return <WorkbenchPanel {...baseProps} api={api} params={params} />;
}

describe("Workbench panel regressions", () => {
  it("keeps ordered v3 state across shallow Dockview echoes", async () => {
    const snapshots: Record<string, unknown>[] = [];
    render(
      <DockviewEchoPanel onEcho={(snapshot) => snapshots.push(snapshot)} />
    );

    for (let index = 0; index < 2; index += 1) {
      fireEvent.click(screen.getByTestId("workbench-add-widget"));
      fireEvent.click(
        await screen.findByTestId(
          "workbench-widget-picker-item-core.custom-card"
        )
      );
    }

    await vi.waitFor(() => expect(snapshots).toHaveLength(2));
    const latest = snapshots.at(-1) as {
      layoutVersion: number;
      widgets: { id: string; widgetId?: string }[];
    };
    expect(latest.layoutVersion).toBe(3);
    expect(latest.widgets).toHaveLength(2);
    expect(
      latest.widgets.every((widget) => widget.widgetId === "core.custom-card")
    ).toBe(true);
  });

  it("scrolls the newly added card only inside its own panel", async () => {
    const scrolled: HTMLElement[] = [];
    Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
      configurable: true,
      value: vi.fn(function record(this: HTMLElement) {
        scrolled.push(this);
      }),
    });
    const first = render(
      <WorkbenchPanel
        {...makeProps({
          layoutVersion: 3,
          widgets: [{ h: 3, id: "core.activity-overview", w: 4 }],
        })}
      />
    );
    const second = render(
      <WorkbenchPanel
        {...makeProps({ layoutVersion: 3, widgets: [] }, vi.fn())}
      />
    );
    const firstCard = within(first.container).getByTestId(
      "workbench-widget-core.activity-overview"
    );

    fireEvent.click(
      within(second.container).getByTestId("workbench-add-widget")
    );
    fireEvent.click(
      await screen.findByTestId(
        "workbench-widget-picker-item-core.activity-overview"
      )
    );

    const secondCard = await within(second.container).findByTestId(
      "workbench-widget-core.activity-overview"
    );
    await vi.waitFor(() => expect(scrolled).toEqual([secondCard]));
    expect(scrolled).not.toContain(firstCard);
  });

  it("shows native-menu failures in the app dialog with technical detail", async () => {
    menuPopupMock.mockRejectedValueOnce(new Error("menu bridge unavailable"));
    render(<AppDialogHost />);
    render(
      <WorkbenchPanel {...makeProps({ layoutVersion: 3, widgets: [] })} />
    );

    openPanelContextMenu();

    expect(
      await screen.findByText("Failed to open Workbench menu")
    ).toBeVisible();
    expect(screen.getByText("menu bridge unavailable")).toBeVisible();
    expect(toast.error).not.toHaveBeenCalled();
  });

  it("refresh-all updates public tokens without writing layout", async () => {
    const mounted = vi.fn();
    const unmounted = vi.fn();
    function RefreshProbe({ refreshToken }: WorkbenchWidgetComponentProps) {
      useEffect(() => {
        mounted();
        return unmounted;
      }, []);
      return <output data-testid="refresh-token">{refreshToken}</output>;
    }
    registerPluginWorkbenchWidget({
      component: RefreshProbe,
      icon: RefreshCw,
      id: "pier.refresh.widget",
    });
    setPluginRegistry([
      makePluginRegistryEntry({
        pluginId: "pier.refresh",
        widgets: [
          {
            id: "pier.refresh.widget",
            permissions: [],
            refreshable: true,
            title: "Refresh",
          },
        ],
      }),
    ]);
    const updateParameters = vi.fn();
    menuPopupMock.mockResolvedValueOnce({
      actionId: "pier.workbench.refreshAll",
    });
    render(
      <WorkbenchPanel
        {...makeProps(
          {
            layoutVersion: 3,
            widgets: [{ h: 3, id: "pier.refresh.widget", w: 4 }],
          },
          updateParameters
        )}
      />
    );

    expect(screen.getByTestId("refresh-token")).toHaveTextContent("0");
    expect(mounted).toHaveBeenCalledTimes(1);
    openPanelContextMenu();

    await vi.waitFor(() =>
      expect(screen.getByTestId("refresh-token")).toHaveTextContent("1")
    );
    expect(mounted).toHaveBeenCalledTimes(1);
    expect(unmounted).not.toHaveBeenCalled();
    expect(updateParameters).not.toHaveBeenCalled();
  });
});
