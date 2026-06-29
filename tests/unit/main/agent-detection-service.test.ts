import { createAgentDetectionService } from "@main/services/agents/agent-detection-service.ts";
import { describe, expect, it } from "vitest";

describe("agent detection", () => {
  it("只返回 probe 命中的 agent", async () => {
    const installed = new Set(["claude", "cursor-agent"]);
    const service = createAgentDetectionService({
      probe: (cmd) => Promise.resolve(installed.has(cmd)),
    });
    const result = await service.detect();
    expect(result.detectedIds).toContain("claude");
    expect(result.detectedIds).toContain("cursor"); // cursor-agent → cursor
    expect(result.detectedIds).not.toContain("codex");
  });

  it("全部未装时返回空", async () => {
    const service = createAgentDetectionService({
      probe: () => Promise.resolve(false),
    });
    expect((await service.detect()).detectedIds).toEqual([]);
  });
});
