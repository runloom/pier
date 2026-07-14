import { createAgentUsageCollectorRunner } from "@main/services/agents/usage-collectors/index.ts";
import type { UsageDataService } from "@main/services/usage-data/usage-data-service.ts";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { rescan } = vi.hoisted(() => ({
  rescan: vi.fn(async () => null),
}));

vi.mock("@main/services/agents/usage-collectors/registry.ts", () => ({
  AGENT_USAGE_COLLECTOR_FACTORIES: [
    () => ({
      agentId: "claude",
      detect: () => true,
      rescan,
      sourceId: "claude-code-local-sessions",
    }),
  ],
}));

describe("agent usage collector runner", () => {
  beforeEach(() => {
    rescan.mockClear();
  });

  it("clears the persisted source when a refresh scan is empty", async () => {
    let refresh: (() => Promise<void>) | undefined;
    const clearBuiltIn = vi.fn(() => true);
    const usageData = {
      clearBuiltIn,
      publishBuiltIn: vi.fn(),
      registerBuiltInSource: vi.fn((source: { rescan(): Promise<void> }) => {
        refresh = source.rescan;
        return vi.fn();
      }),
    } as unknown as UsageDataService;
    const runner = createAgentUsageCollectorRunner({
      usageData,
      userDataDir: "/tmp/pier-test",
    });

    runner.start();
    await refresh?.();

    expect(clearBuiltIn).toHaveBeenCalledWith("claude-code-local-sessions", {
      kind: "machine",
    });
    runner.dispose();
  });
});
