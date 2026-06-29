import { pickAgent } from "@shared/agent-selection.ts";
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
