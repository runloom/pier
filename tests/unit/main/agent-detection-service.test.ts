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

  it("refresh 先水合 PATH 再探测", async () => {
    let hydrated = false;
    const service = createAgentDetectionService({
      probe: (cmd) => Promise.resolve(hydrated && cmd === "claude"),
      hydratePath: () => {
        hydrated = true;
        return Promise.resolve(["/new/bin"]);
      },
    });
    expect((await service.detect()).detectedIds).toEqual([]);
    const r = await service.refresh();
    expect(r.detectedIds).toContain("claude");
    expect(r.addedPathSegments).toEqual(["/new/bin"]);
  });
});
