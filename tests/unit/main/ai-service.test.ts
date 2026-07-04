import type { AgentKind } from "@shared/contracts/agent.ts";
import { projectPreferencesSchema } from "@shared/contracts/preferences.ts";
import { describe, expect, it, vi } from "vitest";
import { supportsOneShot } from "../../../src/main/services/ai/agent-one-shot.ts";
import {
  AgentRunError,
  createAiService,
  defaultRunOneShot,
  type RunOneShotOptions,
} from "../../../src/main/services/ai/ai-service.ts";

function makePreferences(overrides: Record<string, unknown> = {}) {
  return projectPreferencesSchema.parse(overrides);
}

type RunOneShot = (
  binary: string,
  args: readonly string[],
  options: RunOneShotOptions
) => Promise<string>;

function makeService(options: {
  detected?: AgentKind[];
  preferences?: Record<string, unknown>;
  runOneShot?: RunOneShot;
}) {
  return createAiService({
    detectAgents: async () => options.detected ?? [],
    readPreferences: async () => makePreferences(options.preferences ?? {}),
    runOneShot: options.runOneShot ?? (() => Promise.resolve("")),
  });
}

describe("createAiService(agent one-shot)", () => {
  it("status:默认 agent 已检测且支持 one-shot 时使用它", async () => {
    const service = makeService({
      detected: ["gemini", "claude"],
      preferences: { defaultAgentId: "claude" },
    });
    expect(await service.status()).toEqual({
      agent: "claude",
      configured: true,
      label: "Claude",
    });
  });

  it("status:默认未设置时按 auto-pick 顺序兜底到首个可用 agent", async () => {
    const service = makeService({ detected: ["gemini", "codex"] });
    // auto-pick 顺序 claude → codex → … → gemini;claude 未检测,codex 兜底
    expect((await service.status()).agent).toBe("codex");
  });

  it("status:默认 agent 被停用或不支持 one-shot 时跳过", async () => {
    const disabledDefault = makeService({
      detected: ["claude", "gemini"],
      preferences: { defaultAgentId: "claude", disabledAgentIds: ["claude"] },
    });
    expect((await disabledDefault.status()).agent).toBe("gemini");

    // aider 已检测但不在 one-shot 支持表 → 兜底 gemini
    const unsupportedDefault = makeService({
      detected: ["aider", "gemini"],
      preferences: { defaultAgentId: "aider" },
    });
    expect((await unsupportedDefault.status()).agent).toBe("gemini");
    expect(supportsOneShot("aider")).toBe(false);
  });

  it("status:无可用 agent 时 configured=false", async () => {
    const service = makeService({ detected: [] });
    expect(await service.status()).toEqual({
      agent: null,
      configured: false,
      label: "",
    });
  });

  it("generateText:无可用 agent 返回 not_configured 且不运行命令", async () => {
    const runOneShot = vi.fn<RunOneShot>();
    const service = makeService({ detected: [], runOneShot });
    const result = await service.generateText({ prompt: "生成内容" });
    expect(result).toMatchObject({
      reason: "not_configured",
      status: "unavailable",
    });
    expect(runOneShot).not.toHaveBeenCalled();
  });

  it("generateText:成功时以 headless 参数运行 agent 并返回原始文本", async () => {
    const stdout = "some banner\nfeature/fix-dialog-ui\n";
    const runOneShot = vi.fn<RunOneShot>().mockResolvedValue(stdout);
    const service = makeService({
      detected: ["claude"],
      preferences: { defaultAgentId: "claude" },
      runOneShot,
    });

    const result = await service.generateText({
      projectRootPath: "/repo",
      prompt: "Name branch for 修复弹窗 UI",
    });

    expect(result).toEqual({ status: "ok", text: stdout });
    expect(runOneShot).toHaveBeenCalledTimes(1);
    const [binary, args, options] = runOneShot.mock.calls[0] ?? [];
    expect(binary).toBe("claude");
    expect(args?.[0]).toBe("-p");
    expect(args?.[1]).toBe("Name branch for 修复弹窗 UI");
    expect(options).toEqual({ cwd: "/repo", timeoutMs: 45_000 });
  });

  it("generateText:binary 遵循 agentCommandOverrides 覆盖", async () => {
    const runOneShot = vi.fn<RunOneShot>().mockResolvedValue("hello\n");
    const service = makeService({
      detected: ["claude"],
      preferences: {
        agentCommandOverrides: { claude: "/opt/bin/claude --model haiku" },
        defaultAgentId: "claude",
      },
      runOneShot,
    });
    await service.generateText({ prompt: "x" });
    const [binary] = runOneShot.mock.calls[0] ?? [];
    expect(binary).toBe("/opt/bin/claude");
  });

  it("generateText:运行失败/超时分别映射 request_failed/timeout", async () => {
    const failed = makeService({
      detected: ["claude"],
      runOneShot: () =>
        Promise.reject(new AgentRunError("run_failed", "exit 1 -- boom")),
    });
    expect(await failed.generateText({ prompt: "x" })).toMatchObject({
      reason: "request_failed",
      status: "unavailable",
    });

    const timedOut = makeService({
      detected: ["claude"],
      runOneShot: () =>
        Promise.reject(new AgentRunError("timeout", "agent timed out")),
    });
    expect(await timedOut.generateText({ prompt: "x" })).toMatchObject({
      reason: "timeout",
      status: "unavailable",
    });
  });
});

describe("defaultRunOneShot", () => {
  it("closes child stdin so non-interactive agents do not wait for EOF", async () => {
    const stdout = await defaultRunOneShot(
      process.execPath,
      [
        "-e",
        [
          "process.stdin.resume();",
          "process.stdin.on('end', () => process.stdout.write('done\\n'));",
        ].join(""),
      ],
      { cwd: process.cwd(), timeoutMs: 1000 }
    );

    expect(stdout).toBe("done\n");
  });
});
