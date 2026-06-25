import { render } from "@testing-library/react";
import type { IDockviewPanelHeaderProps } from "dockview-react";
import { describe, expect, it, vi } from "vitest";
import { PanelTabHeader } from "@/components/workspace/panel-tab-header.tsx";

function createHeaderProps(
  component: string,
  title: string
): IDockviewPanelHeaderProps {
  return {
    api: {
      component,
      onDidTitleChange: vi.fn(() => ({ dispose: vi.fn() })),
      setActive: vi.fn(),
      title,
    },
    containerApi: {},
    params: {},
    tabLocation: "header",
  } as unknown as IDockviewPanelHeaderProps;
}

describe("PanelTabHeader", () => {
  it("renders the icon declared by the panel kit metadata", () => {
    const { container } = render(
      <PanelTabHeader {...createHeaderProps("terminal", "Terminal")} />
    );

    expect(
      container.querySelector('[data-panel-tab-icon="terminal"]')
    ).not.toBeNull();
  });

  it("renders a different icon for a different panel kit", () => {
    const { container } = render(
      <PanelTabHeader {...createHeaderProps("welcome", "Welcome")} />
    );

    expect(
      container.querySelector('[data-panel-tab-icon="welcome"]')
    ).not.toBeNull();
  });

  it("does not render an icon for unknown panel kits", () => {
    const { container } = render(
      <PanelTabHeader {...createHeaderProps("unknown", "Unknown")} />
    );

    expect(container.querySelector("[data-panel-tab-icon]")).toBeNull();
  });
});
