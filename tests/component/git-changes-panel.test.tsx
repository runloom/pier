import { render, screen } from "@testing-library/react";
import type { IDockviewPanelProps } from "dockview-react";
import { describe, expect, it, vi } from "vitest";
import { GitChangesPanel } from "@/panel-kits/git-changes/git-changes-panel.tsx";

// GitChangesPanel 调 usePanelDescriptor, 需要 mock api.id + api.setTitle.
const mockProps = {
  api: { id: "git-changes-test", setTitle: vi.fn() },
  containerApi: {},
} as unknown as IDockviewPanelProps;

describe("GitChangesPanel", () => {
  it("renders the placeholder heading", () => {
    render(<GitChangesPanel {...mockProps} />);
    expect(screen.getByText("Git 变更")).toBeDefined();
  });

  it("renders the coming-soon hint", () => {
    render(<GitChangesPanel {...mockProps} />);
    expect(screen.getByText("变更预览即将到来")).toBeDefined();
  });
});
