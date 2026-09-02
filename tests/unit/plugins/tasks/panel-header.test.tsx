// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { TaskPanelHeader } from "../../../../packages/plugin-tasks/src/renderer/panel-header.tsx";

describe("task panel header", () => {
  it("renders the files/git header contract without throwing", () => {
    render(
      <TaskPanelHeader
        disabled={false}
        onRefresh={() => undefined}
        onSourceChange={() => undefined}
        onViewChange={() => undefined}
        source="github"
        t={(_key, fallback) => fallback ?? _key}
        view="board"
      />
    );
    expect(screen.getByLabelText("Tracker")).toBeTruthy();
    expect(screen.getByLabelText("Switch to list")).toBeTruthy();
    expect(screen.queryByLabelText("Switch to board")).toBeNull();
    expect(screen.getByLabelText("Refresh")).toBeTruthy();
    expect(
      document.querySelector('[data-slot="file-panel-header"]')
    ).toBeTruthy();
    expect(document.querySelector('[data-slot="select-trigger"]')).toBeTruthy();
  });

  it("spins the refresh control while a refresh is in flight", () => {
    render(
      <TaskPanelHeader
        disabled={false}
        onRefresh={() => undefined}
        onSourceChange={() => undefined}
        onViewChange={() => undefined}
        refreshing
        source="linear"
        t={(_key, fallback) => fallback ?? _key}
        view="list"
      />
    );
    expect(screen.getByLabelText("Switch to board")).toBeTruthy();
    expect(screen.queryByLabelText("Switch to list")).toBeNull();
    const refresh = screen.getByLabelText("Refresh");
    expect(refresh).toBeDisabled();
    expect(refresh).toHaveAttribute("aria-busy", "true");
    expect(refresh.querySelector("svg")?.getAttribute("class")).toContain(
      "animate-spin"
    );
  });
});
