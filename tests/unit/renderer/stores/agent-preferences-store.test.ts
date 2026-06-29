import { describe, expect, it } from "vitest";
import { sanitizeAgentDefaultArgs } from "@/stores/agent-preferences.store.ts";

describe("sanitizeAgentDefaultArgs", () => {
  it("剥除 agent 的 unsupported flag", () => {
    const out = sanitizeAgentDefaultArgs({
      opencode: "--dangerously-skip-permissions --foo",
      claude: "--dangerously-skip-permissions",
    });
    expect(out.opencode).toBe("--foo");
    expect(out.claude).toBe("--dangerously-skip-permissions");
  });

  it("空/无 unsupported 原样", () => {
    expect(sanitizeAgentDefaultArgs({ claude: "--x" })).toEqual({
      claude: "--x",
    });
  });

  it("全部剥除后 key 消失", () => {
    expect(
      sanitizeAgentDefaultArgs({ opencode: "--dangerously-skip-permissions" })
    ).toEqual({});
  });
});
