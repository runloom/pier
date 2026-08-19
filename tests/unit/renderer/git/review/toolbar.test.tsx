import { TooltipProvider } from "@pier/ui/tooltip.tsx";
import { GitReviewSurfaceSwitcher } from "@plugins/builtin/git/renderer/review/surface-switcher.tsx";
import { GitReviewToolbar } from "@plugins/builtin/git/renderer/review/toolbar.tsx";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ReactElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

const context = {
  i18n: {
    t: (
      _key: string,
      _values?: Record<string, number | string>,
      fallback?: string
    ) => fallback ?? _key,
  },
} as never;

function renderToolbar(ui: ReactElement) {
  return render(
    <TooltipProvider delayDuration={0} disableHoverableContent>
      {ui}
    </TooltipProvider>
  );
}

afterEach(() => {
  cleanup();
});

describe("GitReviewToolbar", () => {
  it("shows the responsive inline state without disabling other toolbar actions", () => {
    const onRefresh = vi.fn();
    const onToggleCollapseAll = vi.fn();
    const setViewOptions = vi.fn();
    renderToolbar(
      <GitReviewToolbar
        allCollapsed={false}
        context={context}
        onRefresh={onRefresh}
        onToggleCollapseAll={onToggleCollapseAll}
        refreshing={false}
        responsiveUnified
        setViewOptions={setViewOptions}
        viewOptions={{ diffStyle: "unified", wrapLines: false }}
      />
    );

    const viewButton = screen.getByRole("button", {
      name: "Panel is narrow; using inline view",
    });
    expect(viewButton).toBeDisabled();
    expect(viewButton).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByRole("button", { name: "Wrap lines" })).toBeEnabled();
    expect(
      screen.getByRole("button", { name: "Collapse all files" })
    ).toBeEnabled();
    expect(screen.getByRole("button", { name: "Refresh" })).toBeEnabled();
  });

  it("toggles icons for layout, wrap, and collapse; refresh stays an action", () => {
    const onRefresh = vi.fn();
    const onToggleCollapseAll = vi.fn();
    const setViewOptions = vi.fn();
    const view = renderToolbar(
      <GitReviewToolbar
        allCollapsed={false}
        context={context}
        onRefresh={onRefresh}
        onToggleCollapseAll={onToggleCollapseAll}
        refreshing={false}
        setViewOptions={setViewOptions}
        viewOptions={{ diffStyle: "unified", wrapLines: false }}
      />
    );

    fireEvent.click(
      screen.getByRole("button", { name: "Switch to side-by-side view" })
    );
    expect(setViewOptions).toHaveBeenCalledWith({ diffStyle: "split" });

    fireEvent.click(screen.getByRole("button", { name: "Wrap lines" }));
    expect(setViewOptions).toHaveBeenCalledWith({ wrapLines: true });

    fireEvent.click(screen.getByRole("button", { name: "Collapse all files" }));
    expect(onToggleCollapseAll).toHaveBeenCalledOnce();

    view.rerender(
      <TooltipProvider delayDuration={0} disableHoverableContent>
        <GitReviewToolbar
          allCollapsed
          context={context}
          onRefresh={onRefresh}
          onToggleCollapseAll={onToggleCollapseAll}
          refreshing={false}
          setViewOptions={setViewOptions}
          viewOptions={{ diffStyle: "split", wrapLines: true }}
        />
      </TooltipProvider>
    );

    expect(
      screen.getByRole("button", { name: "Switch to inline view" })
    ).toHaveAttribute("aria-pressed", "true");
    expect(
      screen.getByRole("button", { name: "Disable line wrapping" })
    ).toHaveAttribute("aria-pressed", "true");
    expect(
      screen.getByRole("button", { name: "Expand all files" })
    ).toHaveAttribute("aria-pressed", "true");

    fireEvent.click(screen.getByRole("button", { name: "Refresh" }));
    expect(onRefresh).toHaveBeenCalledOnce();
  });
});

describe("GitReviewSurfaceSwitcher", () => {
  it("re-selects the current tab on pointer down so the same group can re-orient", () => {
    const onSelect = vi.fn();
    renderToolbar(
      <GitReviewSurfaceSwitcher
        context={context}
        groups={["staged", "unstaged"]}
        labels={{
          committed: "Changed Files",
          conflict: "Merge Changes",
          staged: "Staged Changes",
          unstaged: "Changes",
        }}
        onSelect={onSelect}
        value="index"
      />
    );

    fireEvent.pointerDown(screen.getByRole("tab", { name: "Changes" }));
    expect(onSelect).toHaveBeenCalledWith("index");
  });

  it("does not re-select a different tab on pointer down (value change handles that)", () => {
    const onSelect = vi.fn();
    renderToolbar(
      <GitReviewSurfaceSwitcher
        context={context}
        groups={["staged", "unstaged"]}
        labels={{
          committed: "Changed Files",
          conflict: "Merge Changes",
          staged: "Staged Changes",
          unstaged: "Changes",
        }}
        onSelect={onSelect}
        value="index"
      />
    );

    fireEvent.pointerDown(screen.getByRole("tab", { name: "Staged Changes" }));
    expect(onSelect).not.toHaveBeenCalled();
  });
});
