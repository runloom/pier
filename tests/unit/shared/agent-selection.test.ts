import { AGENT_AUTO_PICK_ORDER, pickAgent } from "@shared/agent-selection.ts";
import { agentKindSchema } from "@shared/contracts/agent.ts";
import { describe, expect, it } from "vitest";

describe("pickAgent", () => {
  it("blank → null", () => {
    expect(pickAgent("blank", ["claude"], [])).toBeNull();
  });

  it("具体 agent 已探测+未禁用 → 用它", () => {
    expect(pickAgent("codex", ["claude", "codex"], [])).toBe("codex");
  });

  it("null（auto）→ 优先级表第一个已探测+未禁用", () => {
    expect(pickAgent(null, ["codex", "claude"], [])).toBe("claude");
    expect(pickAgent(null, ["codex"], [])).toBe("codex");
  });

  it("具体 agent 未探测 → fallthrough 优先级表", () => {
    expect(pickAgent("aider", ["claude"], [])).toBe("claude");
  });

  it("禁用不选；都没有 → null", () => {
    expect(pickAgent(null, ["claude"], ["claude"])).toBeNull();
    expect(pickAgent(null, [], [])).toBeNull();
  });
});

describe("AGENT_AUTO_PICK_ORDER", () => {
  it("覆盖全部 AgentKind，无重复无遗漏", () => {
    const all = new Set(agentKindSchema.options);
    const ordered = new Set(AGENT_AUTO_PICK_ORDER);
    expect(ordered.size).toBe(AGENT_AUTO_PICK_ORDER.length); // 无重复
    expect(ordered).toEqual(all); // 无遗漏无多余
  });
  it("claude 首位", () => {
    expect(AGENT_AUTO_PICK_ORDER[0]).toBe("claude");
  });
});
