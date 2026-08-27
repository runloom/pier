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
  it("光标探针只在逐一核实的 agent 上声明（grok / crush）", () => {
    const probed = AGENT_CATALOG.filter(
      (e) => e.inputFocusProbe === "cursor"
    ).map((e) => e.id);
    // 自绘光标 TUI（claude / gemini / opencode / droid / cursor-agent 实测
    // 恒 ?25l）声明探针会持续误报，故必须逐一核实后才加白。
    expect(probed).toEqual(["grok", "crush"]);
  });
  it("声明 inputFocusKey 的 agent 必须同时声明光标探针", () => {
    for (const e of AGENT_CATALOG) {
      if (e.inputFocusKey) {
        expect(e.inputFocusProbe, `${e.id} 有恢复键但无探针`).toBe("cursor");
      }
    }
  });
  it("带参 launchCmd 与 detectCmd 分离（kiro）；hermes/qwen/kilo 探测对齐", () => {
    expect(getAgentCatalogEntry("kiro")?.detectCmd).toBe("kiro-cli");
    expect(getAgentCatalogEntry("kiro")?.launchCmd).toBe("kiro-cli chat --tui");
    // Hermes CLI v0.8+ 无子命令即交互会话，已移除不存在的 --tui。
    expect(getAgentCatalogEntry("hermes")?.launchCmd).toBe("hermes");
    expect(getAgentCatalogEntry("hermes")?.detectCmd).toBe("hermes");
    // npm `@qwen-code/qwen-code` 二进制为 qwen。
    expect(getAgentCatalogEntry("qwen-code")?.launchCmd).toBe("qwen");
    expect(getAgentCatalogEntry("qwen-code")?.detectCmd).toBe("qwen");
    expect(getAgentCatalogEntry("qwen-code")?.detectCmdAliases).toContain(
      "qwen-code"
    );
    expect(getAgentCatalogEntry("kilo")?.detectCmdAliases).toContain(
      "kilocode"
    );
    expect(getAgentCatalogEntry("kimi")?.detectCmdAliases).toContain(
      "kimi-cli"
    );
    expect(getAgentCatalogEntry("qodercli")?.detectCmdAliases).toContain(
      "qoderclicn"
    );
    expect(getAgentCatalogEntry("mistral-vibe")?.detectCmdAliases).toContain(
      "vibe-acp"
    );
  });
  it("Rovo Dev 使用当前 ACLI 入口，检测命令与子命令分离", () => {
    const rovo = getAgentCatalogEntry("rovo");
    expect(rovo?.launchCmd).toBe("acli rovodev run");
    expect(rovo?.launchCommandPrefix).toEqual(["acli", "rovodev", "run"]);
    expect(rovo?.detectCmd).toBe("acli");
    expect(rovo?.expectedProcess).toBe("acli");
  });
});
