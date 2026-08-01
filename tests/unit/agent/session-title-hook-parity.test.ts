/**
 * 金标准：Claude UserPromptSubmit 不得再双写 sessionTitle。
 * derive-claude-session-title 已从 hooks 命令与运行时安装中移除（gen≥11）。
 */

import { describe, expect, it } from "vitest";
import { PIER_HOOK_COMMAND_GENERATION } from "../../../src/main/services/agents/hooks-title-script.ts";
import {
  pierClaudeUserPromptSubmitCommand,
  pierClaudeUserPromptSubmitCommandV3,
} from "../../../src/main/services/agents/integrations/hooks/stdin-commands.ts";

describe("claude session title dual-write removed", () => {
  it("hook generation is at least 11 (derive dual-write dropped)", () => {
    expect(PIER_HOOK_COMMAND_GENERATION).toBeGreaterThanOrEqual(11);
  });

  it("UserPromptSubmit commands only emit, never pipe derive-claude-session-title", () => {
    const legacy = pierClaudeUserPromptSubmitCommand("claude");
    const v3 = pierClaudeUserPromptSubmitCommandV3("claude");
    for (const cmd of [legacy, v3]) {
      expect(cmd).toContain("PromptSubmit");
      expect(cmd).not.toContain("derive-claude-session-title");
      expect(cmd).not.toMatch(/hookSpecificOutput/);
    }
  });
});
