import type { AgentKind } from "@shared/contracts/agent.ts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useAgentDetectStore } from "@/stores/agent-detect.store.ts";

describe("agent detect store", () => {
  const detect = vi.fn<() => Promise<{ detectedIds: AgentKind[] }>>();

  beforeEach(() => {
    vi.clearAllMocks();
    useAgentDetectStore.setState({
      detectedIds: [],
      hasDetected: false,
      isDetecting: false,
      isRefreshing: false,
    });
    Object.defineProperty(window, "pier", {
      configurable: true,
      value: { agents: { detect } },
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    Reflect.deleteProperty(window, "pier");
  });

  it("rejects the original detection error and leaves detection retryable", async () => {
    const error = new Error("detect boom");
    detect.mockRejectedValueOnce(error);
    vi.spyOn(console, "error").mockImplementation(() => undefined);

    await expect(useAgentDetectStore.getState().ensureDetected()).rejects.toBe(
      error
    );

    expect(useAgentDetectStore.getState()).toMatchObject({
      hasDetected: false,
      isDetecting: false,
    });
  });
});
