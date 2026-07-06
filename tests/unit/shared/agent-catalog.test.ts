import {
  AGENT_CATALOG,
  getAgentCatalogEntry,
  getKnownDetectCommands,
} from "@shared/agent-catalog.ts";
import { agentKindSchema } from "@shared/contracts/agent.ts";
import { describe, expect, it } from "vitest";

describe("AGENT_CATALOG", () => {
  it("每个 entry 的 id 都是合法 AgentKind", () => {
    for (const entry of AGENT_CATALOG) {
      expect(() => agentKindSchema.parse(entry.id)).not.toThrow();
    }
  });
  it("按 id 查到 entry", () => {
    expect(getAgentCatalogEntry("claude")?.launchCmd).toBe("claude");
    expect(getAgentCatalogEntry("nope" as never)).toBeUndefined();
  });
  it("getKnownDetectCommands 含 detectCmd 与别名", () => {
    const cmds = getKnownDetectCommands();
    expect(cmds).toContain("claude");
    expect(cmds).toContain("cursor-agent"); // cursor 的 detectCmd
  });
});

describe("AGENT_CATALOG 完整性", () => {
  it("每个 AgentKind 有且仅有一条 entry，且 id 一致", () => {
    for (const id of agentKindSchema.options) {
      const entry = getAgentCatalogEntry(id);
      expect(entry, `缺 entry: ${id}`).toBeDefined();
      expect(entry?.id).toBe(id);
    }
    expect(AGENT_CATALOG.length).toBe(agentKindSchema.options.length);
  });
  it("copilot label 为 GitHub Copilot", () => {
    expect(getAgentCatalogEntry("copilot")?.label).toBe("GitHub Copilot");
  });
  it("有 iconId 的 entry 不冗余设 faviconDomain", () => {
    for (const e of AGENT_CATALOG) {
      if (e.iconId) {
        expect(e.faviconDomain, `${e.id} 冗余 favicon`).toBeUndefined();
      }
    }
  });
  it("gemini 转内联 iconId；openclaude 无图标声明（走本地 favicons 文件）", () => {
    expect(getAgentCatalogEntry("gemini")?.iconId).toBe("gemini");
    const oc = getAgentCatalogEntry("openclaude");
    expect(oc?.iconId).toBeUndefined();
    expect(oc?.faviconDomain).toBeUndefined();
  });
  it("带参 launchCmd 与 detectCmd 分离（kiro/hermes/command-code）", () => {
    expect(getAgentCatalogEntry("kiro")?.detectCmd).toBe("kiro-cli");
    expect(getAgentCatalogEntry("kiro")?.launchCmd).toBe("kiro-cli chat --tui");
    expect(getAgentCatalogEntry("hermes")?.launchCmd).toBe("hermes --tui");
  });
});
