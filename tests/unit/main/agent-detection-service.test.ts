import { createAgentDetectionService } from "@main/services/agents/agent-detection-service.ts";
import { describe, expect, it } from "vitest";

describe("agent detection", () => {
  it("只返回 probe 命中的 agent", async () => {
    const installed = new Set(["claude", "cursor-agent"]);
    const service = createAgentDetectionService({
      hydratePath: () => Promise.resolve([]),
      probe: (cmd) => Promise.resolve(installed.has(cmd)),
    });
    const result = await service.detect();
    expect(result.detectedIds).toContain("claude");
    expect(result.detectedIds).toContain("cursor"); // cursor-agent → cursor
    expect(result.detectedIds).not.toContain("codex");
  });

  it("全部未装时返回空", async () => {
    const service = createAgentDetectionService({
      hydratePath: () => Promise.resolve([]),
      probe: () => Promise.resolve(false),
    });
    expect((await service.detect()).detectedIds).toEqual([]);
  });

  it("detect 先水合 PATH 再探测", async () => {
    let hydrated = false;
    const service = createAgentDetectionService({
      probe: (cmd) => Promise.resolve(hydrated && cmd === "claude"),
      hydratePath: () => {
        hydrated = true;
        return Promise.resolve(["/new/bin"]);
      },
    });
    const result = await service.detect();
    expect(result.detectedIds).toContain("claude");
  });

  it("refresh 强制重新水合 PATH 再探测", async () => {
    let hydrateCount = 0;
    const service = createAgentDetectionService({
      probe: (cmd) => Promise.resolve(hydrateCount >= 2 && cmd === "claude"),
      hydratePath: () => {
        hydrateCount += 1;
        return Promise.resolve([`/new/bin/${hydrateCount}`]);
      },
    });
    expect((await service.detect()).detectedIds).not.toContain("claude");
    const r = await service.refresh();
    expect(r.detectedIds).toContain("claude");
    expect(r.addedPathSegments).toEqual(["/new/bin/2"]);
  });
});
