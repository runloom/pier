import { render, screen } from "@testing-library/react";
import type { IDockviewPanelProps } from "dockview-react";
import { describe, expect, it } from "vitest";
import { WelcomePanel } from "@/components/workspace/welcome-panel.tsx";

// WelcomePanel 不读 props, 测试只需喂满足类型的最小 mock.
// dockview 的 api/containerApi 在此组件不被调用, 用空对象满足结构即可.
const mockProps = {
  api: {},
  containerApi: {},
} as unknown as IDockviewPanelProps;

describe("WelcomePanel", () => {
  it("renders the Pier title", () => {
    render(<WelcomePanel {...mockProps} />);
    expect(screen.getByText("Pier")).toBeDefined();
  });
});
