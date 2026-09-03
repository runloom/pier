import { toServerView } from "@main/services/agent-mcp-catalog/derive-server-views.ts";
import type { McpServerListing } from "@shared/contracts/agent/assets.ts";
import { describe, expect, it } from "vitest";

function listing(
  overrides: Partial<McpServerListing> & { agentId: string }
): McpServerListing {
  return {
    absolutePath: "/tmp/mcp.json",
    agentLabel: overrides.agentId,
    displayPath: ".cursor/mcp.json",
    enabled: true,
    entryId: "e1",
    scopeLabel: "user",
    transport: "stdio",
    ...overrides,
  };
}

describe("toServerView", () => {
  it("promotes mixed project+user listings to project ownership", () => {
    const view = toServerView(
      "github",
      [
        listing({ agentId: "claude", scopeLabel: "user" }),
        listing({
          agentId: "claude",
          entryId: "e2",
          scopeLabel: "project",
          transport: "http",
        }),
      ],
      [],
      ["claude", "codex"]
    );
    expect(view.ownership).toBe("project");
    expect(view.transport).toBe("mixed");
    expect(view.gaps).toEqual([{ agentKind: "codex" }]);
  });

  it("treats pier-memory as managed even when only user-scoped", () => {
    const view = toServerView(
      "pier-memory",
      [listing({ agentId: "grok", scopeLabel: "user" })],
      [],
      ["grok"]
    );
    expect(view.ownership).toBe("pier-managed");
    expect(view.gaps).toEqual([]);
  });
});
