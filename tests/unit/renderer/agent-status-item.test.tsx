import type {
  AgentActivity,
  ForegroundActivityBroadcast,
} from "@shared/contracts/foreground-activity.ts";
import { render } from "@testing-library/react";
import i18next from "i18next";
import { isValidElement } from "react";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { initI18n } from "@/i18n/index.ts";
import { registerAgentStatusItem } from "@/panel-kits/terminal/agent-status-item.tsx";
import { terminalStatusItemRegistry } from "@/panel-kits/terminal/terminal-status-bar.tsx";
import { useForegroundActivityStore } from "@/stores/foreground-activity.store.ts";

const PANEL_ID = "p1";

function agentBroadcast(
  overrides: Partial<AgentActivity> = {}
): ForegroundActivityBroadcast {
  return {
    activities: [
      {
        agentId: "omp",
        kind: "agent",
        panelId: PANEL_ID,
        source: "launch",
        spawnedAt: 1,
        subagentCount: 0,
        updatedAt: 1,
        windowId: "1",
        ...overrides,
      },
    ],
    ts: 1,
  };
}

/** 经注册项 render 渲染(AgentStatusItemView 未导出, registry 是公开入口)。 */
function renderItem() {
  const item = terminalStatusItemRegistry
    .list()
    .find((entry) => entry.id === "core.agent-status");
  if (!item) {
    throw new Error("core.agent-status 未注册");
  }
  const node = item.render({
    context: undefined,
    cwd: null,
    getGroupId: () => null,
    panelId: PANEL_ID,
    title: null,
  });
  if (!isValidElement(node)) {
    throw new Error("core.agent-status render 未返回 ReactElement");
  }
  return render(node);
}

describe("AgentStatusItem 渲染契约", () => {
  let dispose: (() => void) | undefined;

  beforeAll(async () => {
    await initI18n();
    dispose = registerAgentStatusItem();
  });

  afterAll(() => {
    dispose?.();
  });

  beforeEach(() => {
    useForegroundActivityStore.setState({ activities: {}, ts: 0 });
  });

  it("activity 缺席时渲染 null", () => {
    const { container } = renderItem();

    expect(container.firstChild).toBeNull();
  });

  it("launch 先验(无 status)→ icon-only:品牌图标 + sr-only 名称,无 badge", () => {
    useForegroundActivityStore.getState().apply(agentBroadcast());

    const { container } = renderItem();
    const root = container.querySelector('[data-testid="agent-status-item"]');

    expect(root).not.toBeNull();
    expect(root?.getAttribute("data-agent-status")).toBe("none");
    expect(root?.querySelector("svg")).not.toBeNull();
    expect(root?.querySelector("[data-activity-badge]")).toBeNull();
    expect(root?.querySelector(".sr-only")?.textContent).toBeTruthy();
  });

  it("hook 证据 ready → data-agent-status=ready 且 badge 出静态状态文案", () => {
    useForegroundActivityStore
      .getState()
      .apply(agentBroadcast({ stateStartedAt: 1, status: "ready" }));

    const { container } = renderItem();
    const root = container.querySelector('[data-testid="agent-status-item"]');

    expect(root?.getAttribute("data-agent-status")).toBe("ready");
    const badge = root?.querySelector("[data-activity-badge]");
    expect(badge).not.toBeNull();
    // 不锁具体语言:与当前 locale 下 ready 文案一致即可(错映射到别的状态词会红)。
    expect(badge?.textContent).toBe(i18next.t("terminal.agentStatus.ready"));
    // ready 是静态文案分支,不走 shimmer。
    expect(badge?.querySelector("[data-agent-status-text]")).toBeNull();
    expect(badge?.querySelector("[data-activity-badge-text]")).not.toBeNull();
  });

  it("processing → shimmer 分支(AgentShimmerText 扫光文本)", () => {
    useForegroundActivityStore
      .getState()
      .apply(agentBroadcast({ stateStartedAt: 1, status: "processing" }));

    const { container } = renderItem();
    const root = container.querySelector('[data-testid="agent-status-item"]');

    expect(root?.getAttribute("data-agent-status")).toBe("processing");
    const shimmer = root?.querySelector(
      "[data-activity-badge] [data-agent-status-text]"
    );
    expect(shimmer).not.toBeNull();
    expect(shimmer?.getAttribute("data-agent-status-kind")).toBe("running");
    expect(shimmer?.textContent).toBe(
      i18next.t("terminal.agentStatus.processing")
    );
  });
});
