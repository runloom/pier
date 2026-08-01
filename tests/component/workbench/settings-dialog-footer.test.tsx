import { Button } from "@pier/ui/button.tsx";
import type { WorkbenchWidgetSettingsProps } from "@plugins/api/renderer.ts";
import { cleanup, render, screen } from "@testing-library/react";
import { useLayoutEffect } from "react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { initI18n } from "@/i18n/index.ts";
import type { ResolvedWorkbenchWidget } from "@/panel-kits/workbench/merge.ts";
import { WorkbenchSettingsDialog } from "@/panel-kits/workbench/settings-dialog.tsx";

function SettingsWithFooter({ setFooter }: WorkbenchWidgetSettingsProps) {
  useLayoutEffect(() => {
    setFooter(
      <Button data-testid="settings-footer-cta" type="button">
        Add block
      </Button>
    );
    return () => {
      setFooter(null);
    };
  }, [setFooter]);
  return <div data-testid="settings-body">body</div>;
}

function coreWidget(): ResolvedWorkbenchWidget {
  return {
    category: "custom",
    configurable: true,
    description: "workbench.widget.customCard.description",
    id: "core.custom-card",
    instanceId: "inst-1",
    multiInstance: true,
    params: {},
    registration: {
      component: () => null,
      icon: () => null,
      id: "core.custom-card",
      settingsComponent: SettingsWithFooter,
    },
    refreshable: false,
    searchTerms: [],
    status: "core",
    title: "workbench.widget.customCard.title",
    widgetId: "core.custom-card",
  } as unknown as ResolvedWorkbenchWidget;
}

describe("WorkbenchSettingsDialog sticky footer", () => {
  beforeAll(async () => {
    await initI18n();
  });

  afterEach(() => {
    cleanup();
  });

  it("shows footer registered by settingsComponent on first open", () => {
    render(
      <WorkbenchSettingsDialog
        onOpenChange={vi.fn()}
        updateParams={vi.fn()}
        widget={coreWidget()}
      />
    );

    expect(screen.getByTestId("settings-body")).toBeInTheDocument();
    expect(screen.getByTestId("settings-footer-cta")).toBeInTheDocument();
    expect(
      screen.getByTestId("workbench-widget-settings-footer")
    ).toContainElement(screen.getByTestId("settings-footer-cta"));
  });

  it("clears footer when dialog closes", () => {
    const { rerender } = render(
      <WorkbenchSettingsDialog
        onOpenChange={vi.fn()}
        updateParams={vi.fn()}
        widget={coreWidget()}
      />
    );
    expect(screen.getByTestId("settings-footer-cta")).toBeInTheDocument();

    rerender(
      <WorkbenchSettingsDialog
        onOpenChange={vi.fn()}
        updateParams={vi.fn()}
        widget={null}
      />
    );
    expect(screen.queryByTestId("settings-footer-cta")).not.toBeInTheDocument();
  });
});
