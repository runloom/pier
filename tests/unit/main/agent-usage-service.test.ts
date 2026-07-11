import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createAgentUsageService,
  recordAgentUse,
} from "@main/services/agents/agent-usage-service.ts";
import { EMPTY_AGENT_USAGE_STATE } from "@shared/contracts/agent-usage.ts";
import { afterEach, describe, expect, it } from "vitest";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((path) => rm(path, { force: true, recursive: true }))
  );
});

describe("agent usage service", () => {
  it("只更新目标 agent 的次数和最近使用时间", () => {
    const once = recordAgentUse(EMPTY_AGENT_USAGE_STATE, "codex", 1000);
    const twice = recordAgentUse(once, "codex", 2000);
    const withClaude = recordAgentUse(twice, "claude", 3000);

    expect(withClaude.entries).toEqual([
      { agentId: "claude", lastUsedAt: 3000, useCount: 1 },
      { agentId: "codex", lastUsedAt: 2000, useCount: 2 },
    ]);
  });

  it("将成功启动历史持久化到独立 userData 文件", async () => {
    const userDataDir = await mkdtemp(join(tmpdir(), "pier-agent-usage-"));
    temporaryDirectories.push(userDataDir);
    let currentTime = 1000;
    const first = createAgentUsageService({
      now: () => currentTime,
      userDataDir,
    });

    await first.recordSuccessfulLaunch("codex");
    currentTime = 2000;
    await first.recordSuccessfulLaunch("codex");
    await first.flush();

    const restored = createAgentUsageService({ userDataDir });
    expect(await restored.read()).toEqual({
      entries: [{ agentId: "codex", lastUsedAt: 2000, useCount: 2 }],
      version: 1,
    });
  });
});
