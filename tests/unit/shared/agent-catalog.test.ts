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
