import { render, screen } from "@testing-library/react";
import { DockviewReact } from "dockview-react";
import { describe, expect, it, vi } from "vitest";
import { WorkspaceHost } from "@/components/workspace/workspace-host.tsx";

vi.mock("dockview-react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("dockview-react")>();
  return {
    ...actual,
    DockviewReact: vi.fn((props) => (
      <div
        data-disable-tabs-overflow-list={String(props.disableTabsOverflowList)}
        data-left-header-actions={
          props.leftHeaderActionsComponent?.name ?? "none"
        }
        data-testid="dockview"
      />
    )),
  };
});

describe("WorkspaceHost", () => {
  it("disables dockview overflow and uses the workspace shadcn header actions", () => {
    render(<WorkspaceHost />);

    expect(screen.getByTestId("dockview")).toHaveAttribute(
      "data-disable-tabs-overflow-list",
      "true"
    );
    expect(screen.getByTestId("dockview")).toHaveAttribute(
      "data-left-header-actions",
      "WorkspaceHeaderActions"
    );
    expect(DockviewReact).toHaveBeenCalled();
  });
});
