import { render, screen } from "@testing-library/react";
import type { IDockviewPanelProps } from "dockview-react";
import { describe, expect, it, vi } from "vitest";
import { WelcomePanel } from "@/components/workspace/welcome-panel.tsx";

// WelcomePanel 现在调 usePanelDescriptor, 需要 mock api.id + api.setTitle.
// dockview 的 containerApi 在此组件不被调用, 用空对象满足结构即可.
const mockProps = {
  api: { id: "welcome-test", setTitle: vi.fn() },
  containerApi: {},
} as unknown as IDockviewPanelProps;

describe("WelcomePanel", () => {
  it("renders the Pier title", () => {
    render(<WelcomePanel {...mockProps} />);
    expect(screen.getByText("Pier")).toBeDefined();
  });
});
