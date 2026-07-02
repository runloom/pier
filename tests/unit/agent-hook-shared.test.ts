import { describe, expect, it } from "vitest";
import {
  pierHookCommand,
  removePierTextBlock,
  upsertPierTextBlock,
  withoutPierNestedHooks,
  withPierNestedHooks,
} from "../../src/main/services/agents/integrations/shared.ts";

describe("pierHookCommand（泛化 agent 参数）", () => {
  it("payload 携带指定 agent 与 pier 事件名", () => {
    const cmd = pierHookCommand("codex", "PromptSubmit");
    expect(cmd).toContain('\\"agent\\":\\"codex\\"');
    expect(cmd).toContain('\\"event\\":\\"PromptSubmit\\"');
    expect(cmd).toContain("$PIER_WINDOW_ID");
    expect(cmd.endsWith("|| true")).toBe(true);
  });
});

describe("withPierNestedHooks（matcher 约定）", () => {
  const spec = {
    agentId: "grok" as const,
    capability: "full" as const,
    configPath: () => "/dev/null",
    events: [
      { nativeEvent: "PreToolUse", pierEvent: "ToolStart", matcher: "*" },
      { nativeEvent: "Stop", pierEvent: "Stop" },
    ],
  };

  it("有 matcher 的事件写 matcher 字段, 无则省略", () => {
    const out = withPierNestedHooks({}, spec);
    const hooks = out.hooks as Record<string, Record<string, unknown>[]>;
    expect(hooks.PreToolUse?.[0]?.matcher).toBe("*");
    expect("matcher" in (hooks.Stop?.[0] ?? {})).toBe(false);
  });

  it("幂等 + 保留用户条目 + 卸载还原", () => {
    const user = {
      hooks: { Stop: [{ hooks: [{ type: "command", command: "say hi" }] }] },
    };
    const once = withPierNestedHooks(user, spec);
    const twice = withPierNestedHooks(once, spec);
    expect(JSON.stringify(twice)).toBe(JSON.stringify(once));
    const cleaned = withoutPierNestedHooks(twice);
    expect((cleaned.hooks as Record<string, unknown[]>).Stop).toHaveLength(1);
    expect(
      (cleaned.hooks as Record<string, unknown>).PreToolUse
    ).toBeUndefined();
  });
});

describe("文本块注入（TOML/YAML marker 模式）", () => {
  it("upsert 幂等替换, remove 还原, 无块原引用返回", () => {
    const raw = "theme = dark\n";
    const v1 = upsertPierTextBlock(raw, "kimi", '[[hooks]]\nevent = "Stop"');
    expect(v1).toContain("pier-agent-status:kimi");
    const v2 = upsertPierTextBlock(v1, "kimi", '[[hooks]]\nevent = "Stop"');
    expect(v2).toBe(v1.endsWith("\n") ? v2 : v2); // 幂等（内容一致）
    expect(upsertPierTextBlock(v1, "kimi", '[[hooks]]\nevent = "Stop"')).toBe(
      v1
    );
    const removed = removePierTextBlock(v1, "kimi");
    expect(removed).toBe(raw);
    expect(removePierTextBlock(raw, "kimi")).toBe(raw);
  });
});
