import { render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { initI18n } from "@/i18n/index.ts";
import { registerAgentStatusItem } from "@/panel-kits/terminal/agent-status-item.tsx";
import { terminalStatusItemRegistry } from "@/panel-kits/terminal/status-bar.tsx";
import { useForegroundActivityStore } from "@/stores/foreground-activity.store.ts";

const statusCtx = {
  context: undefined,
  cwd: null,
  getGroupId: () => null,
  panelId: "terminal-1",
  title: null,
};

describe("agent status bar item", () => {
  let dispose: (() => void) | undefined;

  beforeEach(async () => {
    await initI18n();
    dispose = registerAgentStatusItem();
    useForegroundActivityStore.setState({
      activities: {},
      ts: 0,
    });
  });

  afterEach(() => {
    dispose?.();
    dispose = undefined;
    useForegroundActivityStore.setState({
      activities: {},
      ts: 0,
    });
  });

  it("is visible with readable label when FA is agent even without hook status", () => {
    const now = Date.now();
    useForegroundActivityStore.setState({
      activities: {
        "terminal-1": {
          agentId: "grok",
          kind: "agent",
          panelId: "terminal-1",
          source: "launch",
          spawnedAt: now,
          subagentCount: 0,
          updatedAt: now,
          windowId: "w1",
        },
      },
      ts: 1,
    });

    const agentItem = terminalStatusItemRegistry
      .list()
      .find((item) => item.isVisible?.(statusCtx));
    expect(agentItem).toBeDefined();
    const { container } = render(agentItem?.render(statusCtx) ?? null);
    const root = container.querySelector('[data-testid="agent-status-item"]');
    expect(root).not.toBeNull();
    // 必须有可见文案（catalog 名或状态词），不能只剩 icon
    const visibleBadge = root?.querySelector("[data-activity-badge-text]");
    expect(visibleBadge?.textContent?.trim().length).toBeGreaterThan(0);
    expect(visibleBadge?.textContent).toMatch(/grok/i);
    // sr-only 同步有 agent 名（a11y），不参与「可见可读」判定
    expect(screen.getAllByText(/grok/i).length).toBeGreaterThanOrEqual(1);
  });
});
