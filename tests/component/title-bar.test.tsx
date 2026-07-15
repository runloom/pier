import { makeAgentRef } from "@shared/contracts/agent-runtime-index.ts";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AgentIndexChromeBar } from "@/components/common/agent-index-chrome-bar.tsx";
import { TitleBar } from "@/components/common/title-bar.tsx";
import { initI18n } from "@/i18n/index.ts";
import { useAgentRuntimeIndexStore } from "@/stores/agent-runtime-index.store.ts";

vi.mock("@/lib/actions/agent-runtime-actions.ts", () => ({
  openAgentIndexQuickPick: vi.fn(async () => undefined),
}));

describe("TitleBar / AgentIndexChromeBar", () => {
  beforeEach(async () => {
    await initI18n();
    useAgentRuntimeIndexStore.getState().reset();
  });

  afterEach(() => {
    cleanup();
    useAgentRuntimeIndexStore.getState().reset();
    document.documentElement.style.removeProperty("--app-titlebar-height");
  });

  it("publishes the draggable titlebar height for portal overlays", () => {
    const view = render(<TitleBar />);
    expect(
      document.documentElement.style.getPropertyValue("--app-titlebar-height")
    ).toBe("38px");
    view.unmount();
    expect(
      document.documentElement.style.getPropertyValue("--app-titlebar-height")
    ).toBe("0px");
  });

  it("shows Index needsYou / running counts on mac title bar", () => {
    seedCounts();
    render(<TitleBar />);
    expect(screen.getByTestId("titlebar-agent-counts")).toBeTruthy();
  });

  it("shows the same counts control on non-mac chrome bar", () => {
    seedCounts();
    render(<AgentIndexChromeBar />);
    expect(screen.getByTestId("agent-index-chrome-bar")).toBeTruthy();
    expect(screen.getByTestId("titlebar-agent-counts")).toBeTruthy();
  });
});

function seedCounts(): void {
  useAgentRuntimeIndexStore.getState().applySnapshot({
    entries: [
      {
        agentId: "claude",
        agentRef: makeAgentRef("1", "w"),
        panelId: "w",
        source: "hook",
        status: "waiting",
        updatedAt: 2,
        windowId: "1",
      },
      {
        agentId: "codex",
        agentRef: makeAgentRef("1", "p"),
        panelId: "p",
        source: "hook",
        status: "processing",
        updatedAt: 3,
        windowId: "1",
      },
    ],
    ts: 1,
  });
}
