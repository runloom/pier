import type { AgentKind } from "@shared/contracts/agent.ts";
import { projectPreferencesSchema } from "@shared/contracts/preferences.ts";
import { describe, expect, it, vi } from "vitest";
import {
  extractAnswerLine,
  supportsOneShot,
} from "../../../src/main/services/ai/agent-one-shot.ts";
import {
  AgentRunError,
  createAiService,
  normalizeSlug,
} from "../../../src/main/services/ai/ai-service.ts";

function makePreferences(overrides: Record<string, unknown> = {}) {
  return projectPreferencesSchema.parse(overrides);
}

type RunOneShot = (
  binary: string,
  args: readonly string[],
  timeoutMs: number
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

describe("normalizeSlug", () => {
  it("小写化、空白与非法字符折叠为连字符、去首尾符号", () => {
    expect(normalizeSlug("Fix Dialog UI")).toBe("fix-dialog-ui");
    expect(normalizeSlug("  `fix-login`.  ")).toBe("fix-login");
    expect(normalizeSlug("fix_login/flow")).toBe("fix-login-flow");
  });

  it("超长 slug 截断到完整单词", () => {
    const slug = normalizeSlug(
      "implement-comprehensive-workspace-layout-manager"
    );
    expect(slug.length).toBeLessThanOrEqual(32);
    expect(slug.endsWith("-")).toBe(false);
    expect(slug).toBe("implement-comprehensive");
  });

  it("全非法内容返回空串", () => {
    expect(normalizeSlug("！！！")).toBe("");
    expect(normalizeSlug("")).toBe("");
  });
});

describe("extractAnswerLine", () => {
  it("取最后一个非空行并剥离 ANSI 转义", () => {
    expect(
      extractAnswerLine("banner line\nthinking...\n\nfix-dialog-ui\n\n")
    ).toBe("fix-dialog-ui");
    expect(extractAnswerLine("\u001b[32mfix-x\u001b[0m\n")).toBe("fix-x");
    expect(extractAnswerLine("")).toBe("");
  });
});

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

  it("suggestBranch:无可用 agent 返回 not_configured 且不运行命令", async () => {
    const runOneShot = vi.fn<RunOneShot>();
    const service = makeService({ detected: [], runOneShot });
    const result = await service.suggestBranch({ text: "修复弹窗" });
    expect(result).toMatchObject({
      reason: "not_configured",
      status: "unavailable",
    });
    expect(runOneShot).not.toHaveBeenCalled();
  });

  it("suggestBranch:成功时以 headless 参数运行 agent 并规整输出", async () => {
    const runOneShot = vi
      .fn<RunOneShot>()
      .mockResolvedValue("some banner\nFix-Dialog-UI.\n");
    const service = makeService({
      detected: ["claude"],
      preferences: { defaultAgentId: "claude" },
      runOneShot,
    });

    const result = await service.suggestBranch({ text: "修复弹窗 UI" });

    expect(result).toEqual({ slug: "fix-dialog-ui", status: "ok" });
    expect(runOneShot).toHaveBeenCalledTimes(1);
    const [binary, args] = runOneShot.mock.calls[0] ?? [];
    expect(binary).toBe("claude");
    expect(args?.[0]).toBe("-p");
    expect(args?.[1]).toContain("修复弹窗 UI");
  });

  it("suggestBranch:binary 遵循 agentCommandOverrides 覆盖", async () => {
    const runOneShot = vi.fn<RunOneShot>().mockResolvedValue("fix-x\n");
    const service = makeService({
      detected: ["claude"],
      preferences: {
        agentCommandOverrides: { claude: "/opt/bin/claude --model haiku" },
        defaultAgentId: "claude",
      },
      runOneShot,
    });
    await service.suggestBranch({ text: "x" });
    const [binary] = runOneShot.mock.calls[0] ?? [];
    expect(binary).toBe("/opt/bin/claude");
  });

  it("suggestBranch:运行失败/超时分别映射 request_failed/timeout", async () => {
    const failed = makeService({
      detected: ["claude"],
      runOneShot: () =>
        Promise.reject(new AgentRunError("run_failed", "exit 1 -- boom")),
    });
    expect(await failed.suggestBranch({ text: "x" })).toMatchObject({
      reason: "request_failed",
      status: "unavailable",
    });

    const timedOut = makeService({
      detected: ["claude"],
      runOneShot: () =>
        Promise.reject(new AgentRunError("timeout", "agent timed out")),
    });
    expect(await timedOut.suggestBranch({ text: "x" })).toMatchObject({
      reason: "timeout",
      status: "unavailable",
    });
  });

  it("suggestBranch:输出无有效 slug 映射 invalid_response", async () => {
    const service = makeService({
      detected: ["claude"],
      runOneShot: () => Promise.resolve("！！！\n"),
    });
    expect(await service.suggestBranch({ text: "x" })).toMatchObject({
      reason: "invalid_response",
      status: "unavailable",
    });
  });
});
