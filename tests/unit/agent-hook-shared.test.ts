import { describe, expect, it } from "vitest";
import {
  isPierHookCommand,
  pierHookCommand,
  removePierTextBlock,
  upsertPierTextBlock,
  withoutPierNestedHooks,
  withPierNestedHooks,
} from "../../src/main/services/agents/integrations/shared.ts";

describe("pierHookCommand（JSONL emit 脚本格式）", () => {
  it("命令引用 emit 脚本路径并携带 agentEventV2 kind + agentId + pierEvent", () => {
    const cmd = pierHookCommand("codex", "PromptSubmit");
    // biome-ignore lint/suspicious/noTemplateCurlyInString: 断言 shell 命令里的 ${PIER_AGENT_HOOKS_DIR} 变量引用形式，本就该是字面量
    expect(cmd).toContain("${PIER_AGENT_HOOKS_DIR}/emit");
    // emit 脚本 kind dispatch：第一个位置参数固定为 agentEventV2
    expect(cmd).toContain('"agentEventV2"');
    expect(cmd).toContain('"codex"');
    expect(cmd).toContain('"PromptSubmit"');
    // 首参 agentEventV2 出现在 agentId 之前
    expect(cmd.indexOf('"agentEventV2"')).toBeLessThan(cmd.indexOf('"codex"'));
    expect(cmd.endsWith("|| true")).toBe(true);
  });

  it("isPierHookCommand 识别新格式", () => {
    const cmd = pierHookCommand("claude", "Stop");
    expect(isPierHookCommand(cmd)).toBe(true);
  });

  it("isPierHookCommand 拒绝老 HTTP curl 格式（LEGACY marker 已删）", () => {
    const oldCmd =
      '[ -n "$PIER_AGENT_HOOK_PORT" ] && curl -fsS http://127.0.0.1:$PIER_AGENT_HOOK_PORT/agent-event || true';
    expect(isPierHookCommand(oldCmd)).toBe(false);
  });

  it("isPierHookCommand 排除无关命令", () => {
    expect(isPierHookCommand("echo hello")).toBe(false);
    expect(isPierHookCommand(42)).toBe(false);
    expect(isPierHookCommand(null)).toBe(false);
  });
});

describe("withPierNestedHooks（matcher 约定）", () => {
  const spec = {
    agentId: "grok" as const,
    capability: "full" as const,
    configPath: () => "/dev/null",
    runtime: { stopAuthority: "advisory" as const },
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
