import { focusAgentFromNotificationClick } from "@main/services/agent-attention/notification-click-focus.ts";
import type { AgentRuntimeIndexService } from "@main/services/agent-runtime-index/index.ts";
import { AGENT_ATTENTION_KIND } from "@shared/contracts/agent-attention.ts";
import { beforeEach, describe, expect, it, vi } from "vitest";

const broadcastMock = vi.hoisted(() => ({
  broadcastAgentRuntimeFocusFeedback: vi.fn(),
}));

vi.mock("@main/app-core/window-broadcasts.ts", () => broadcastMock);

describe("focusAgentFromNotificationClick", () => {
  const focus = vi.fn();

  beforeEach(() => {
    focus.mockReset();
    broadcastMock.broadcastAgentRuntimeFocusFeedback.mockReset();
  });

  function index(): AgentRuntimeIndexService {
    return {
      focus,
      focusWaiting: vi.fn(),
      listMachine: vi.fn(),
    };
  }

  it("focuses agent.attention clicks and broadcasts non-ok", async () => {
    focus.mockResolvedValue({ status: "panel_gone" });
    await focusAgentFromNotificationClick(index(), {
      agentRef: "1\0p1",
      kind: AGENT_ATTENTION_KIND,
      title: "Claude",
    });
    expect(focus).toHaveBeenCalledWith("1\0p1");
    expect(
      broadcastMock.broadcastAgentRuntimeFocusFeedback
    ).toHaveBeenCalledWith({ status: "panel_gone" });
  });

  it("ignores other notification kinds", async () => {
    await focusAgentFromNotificationClick(index(), {
      agentRef: "1\0p1",
      kind: "other",
      title: "x",
    });
    expect(focus).not.toHaveBeenCalled();
  });

  it("broadcasts thrown focus errors", async () => {
    focus.mockRejectedValue(new Error("boom"));
    await focusAgentFromNotificationClick(index(), {
      agentRef: "1\0p1",
      kind: AGENT_ATTENTION_KIND,
      title: "Claude",
    });
    expect(
      broadcastMock.broadcastAgentRuntimeFocusFeedback
    ).toHaveBeenCalledWith({
      message: "boom",
      status: "error",
    });
  });
});
