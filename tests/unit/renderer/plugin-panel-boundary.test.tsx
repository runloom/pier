// @vitest-environment jsdom

import type { PluginPanelRegistration } from "@plugins/api/renderer.ts";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { withPluginPanelHostBoundary } from "@/components/workspace/panel-resource-boundary.tsx";

vi.mock("@/i18n/use-t.ts", () => ({
  useT: () => (key: string) => key,
}));

/**
 * 失败语义契约 F1（docs/superpowers/specs/2026-08-24-plugin-failure-semantics.md）：
 * 插件面板渲染抛错 → 仅该面板显示局部错误态，同屏其它面板不受影响，
 * 错误不得冒泡到 App 级边界。
 */

function makeProps(component: string) {
  return {
    api: {
      component,
      id: `${component}-instance`,
      isVisible: true,
      onDidVisibilityChange: () => ({ dispose: () => undefined }),
      setTitle: () => undefined,
      title: component,
    },
    params: {},
  } as unknown as Parameters<ReturnType<typeof withPluginPanelHostBoundary>>[0];
}

function registration(
  id: string,
  Component: React.FunctionComponent
): PluginPanelRegistration {
  return {
    component: Component,
    icon: {} as PluginPanelRegistration["icon"],
    id,
    kind: "web",
  };
}

function Throwing(): null {
  throw new Error("plugin exploded");
}

describe("plugin panel failure isolation (F1)", () => {
  it("renders a panel-local crash state and keeps sibling panels alive", () => {
    const Broken = withPluginPanelHostBoundary(
      registration("broken.plugin-panel", Throwing)
    );
    const Healthy = withPluginPanelHostBoundary(
      registration("healthy.plugin-panel", () => (
        <div data-testid="healthy-body">ok</div>
      ))
    );

    const { unmount } = render(
      <>
        <Broken {...makeProps("broken.plugin-panel")} />
        <Healthy {...makeProps("healthy.plugin-panel")} />
      </>
    );

    // 崩溃面板显示局部错误态（文案 key 即断言，i18n 已 mock）。
    expect(screen.getByText("workspace.pluginPanel.crashTitle")).toBeTruthy();
    expect(screen.getByText(/crashDescription/)).toBeTruthy();

    // 兄弟面板照常渲染 —— 爆炸半径被限制在单面板内。
    expect(screen.getByTestId("healthy-body")).toBeTruthy();

    unmount();
  });

  it("recovers the panel body after a transient error is replaced", () => {
    let shouldThrow = true;
    function Flaky(): React.ReactNode {
      if (shouldThrow) {
        throw new Error("transient");
      }
      return <div data-testid="flaky-body">recovered</div>;
    }
    const Panel = withPluginPanelHostBoundary(
      registration("flaky.plugin-panel", Flaky)
    );

    const { rerender } = render(<Panel {...makeProps("flaky.plugin-panel")} />);
    expect(screen.getByText("workspace.pluginPanel.crashTitle")).toBeTruthy();

    // 重载后同一注册组件恢复正常渲染（边界按代次重置）。
    shouldThrow = false;
    const Next = withPluginPanelHostBoundary(
      registration("flaky.plugin-panel", Flaky)
    );
    rerender(<Next {...makeProps("flaky.plugin-panel")} />);
    expect(screen.getByTestId("flaky-body")).toBeTruthy();
  });
});
