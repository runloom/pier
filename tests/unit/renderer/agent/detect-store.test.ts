import { emptyDomainSnapshot } from "@shared/contracts/host-catalog/runtime.ts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useAgentDetectStore } from "@/stores/agent-detect.store.ts";
import { useHostCatalogStore } from "@/stores/host-catalog/store.ts";

describe("agent detect store", () => {
  const ensureFresh = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    useHostCatalogStore.getState().reset();
    useAgentDetectStore.setState({
      detectedIds: [],
      hasDetected: false,
      isDetecting: false,
      isRefreshing: false,
    });
    Object.defineProperty(window, "pier", {
      configurable: true,
      value: { catalog: { ensureFresh } },
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    Reflect.deleteProperty(window, "pier");
    useHostCatalogStore.getState().reset();
  });

  it("does not revalidate when a previous detect snapshot already exists", async () => {
    useAgentDetectStore.setState({
      detectedIds: ["claude"],
      hasDetected: true,
    });

    await useAgentDetectStore.getState().ensureDetected();

    expect(ensureFresh).not.toHaveBeenCalled();
  });

  it("rejects the catalog error and leaves detection retryable", async () => {
    const error = new Error("detect boom");
    ensureFresh.mockRejectedValueOnce(error);
    vi.spyOn(console, "error").mockImplementation(() => undefined);

    await expect(useAgentDetectStore.getState().ensureDetected()).rejects.toBe(
      error
    );

    expect(useAgentDetectStore.getState()).toMatchObject({
      hasDetected: false,
      isDetecting: false,
    });
  });

  it("fills detectedIds from a local catalog refresh", async () => {
    ensureFresh.mockResolvedValueOnce({
      ...emptyDomainSnapshot("agent-cli"),
      items: [
        {
          details: null,
          domain: "agent-cli",
          id: "claude",
          label: "Claude",
          localVersion: "1.0.0",
          presence: "present",
          remoteVersion: null,
          updateOffered: false,
        },
      ],
    });

    await useAgentDetectStore.getState().ensureDetected();

    expect(ensureFresh).toHaveBeenCalledWith({
      class: "local",
      domain: "agent-cli",
    });
    expect(useAgentDetectStore.getState().detectedIds).toEqual(["claude"]);
  });
});
