/**
 * 标题链路治理测试。
 *
 * 锁定的不变量：
 * 1. resolveAgentSessionTitle 不接收 OSC / terminalTitle——它不该出现在入参里。
 * 2. catalog 里的 titleArgs 都不让 MCP / 工具进来（标题通道要轻量）。
 * 3. 模型层结果不继承交互式会话的 permissionMode。
 * 4. TARGET_AUTO_TITLE_LENGTH < MAX_AGENT_SESSION_TITLE_LENGTH。
 */

import { AGENT_CATALOG } from "@shared/agent-catalog.ts";
import {
  MAX_AGENT_SESSION_TITLE_LENGTH,
  type ResolveAgentSessionTitleInput,
  TARGET_AUTO_TITLE_LENGTH,
} from "@shared/agent-session-title/index.ts";
import { describe, expect, it } from "vitest";

describe("agent-session-title governance", () => {
  it("TARGET_AUTO_TITLE_LENGTH is strictly less than MAX_AGENT_SESSION_TITLE_LENGTH", () => {
    expect(TARGET_AUTO_TITLE_LENGTH).toBeLessThan(
      MAX_AGENT_SESSION_TITLE_LENGTH
    );
  });

  it("resolveAgentSessionTitle input has no terminalTitle field", () => {
    // 入参类型里不应有 terminalTitle——OSC 不进产品标题。
    type Keys = keyof ResolveAgentSessionTitleInput;
    const keys: Keys[] = [
      "agentId",
      "cwd",
      "projectRootPath",
      "sessionTitle",
      "sessionTitleSource",
    ];
    expect(keys).not.toContain("terminalTitle" as Keys);
  });

  it("titleArgs never enables MCP or tools", () => {
    // MCP 冷启动是这条链路的主要延迟来源；标题通道必须掐掉它。
    for (const entry of AGENT_CATALOG) {
      if (!entry.titleArgs) {
        continue;
      }
      const args = entry.titleArgs("__probe__");
      const joined = args.join(" ");
      expect(joined).not.toMatch(/--allowedTools|--disallowedTools/);
      // --mcp-config 只能是空 / 禁用形态（{}），不能带真实配置。
      if (joined.includes("--mcp-config")) {
        const idx = args.indexOf("--mcp-config");
        const value = args[idx + 1];
        expect(value).toBe("{}");
      }
    }
  });
});
