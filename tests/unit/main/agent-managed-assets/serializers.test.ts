import {
  buildServerEntry,
  fingerprintManagedSlice,
  planJsonUpsert,
  planOpenCodeUpsert,
  planRemove,
  planTomlAppend,
} from "@main/services/agent-managed-assets/serializers.ts";
import { describe, expect, it } from "vitest";

const STORE = "/home/u/.p/pier.memory/abc123/memory.jsonl";

describe("mcp-servers-json upsert", () => {
  it("creates skeleton when file missing", () => {
    const plan = planJsonUpsert(null, STORE);
    expect(plan.ok).toBe(true);
    if (!plan.ok || typeof plan.next !== "string") {
      return;
    }
    expect(JSON.parse(plan.next)).toEqual({
      mcpServers: {
        "pier-memory": buildServerEntry(STORE),
      },
    });
  });

  it("merges into existing config preserving other keys", () => {
    const raw = JSON.stringify({
      mcpServers: { mine: { command: "x" } },
      other: true,
    });
    const plan = planJsonUpsert(raw, STORE);
    expect(plan.ok).toBe(true);
    if (!plan.ok || typeof plan.next !== "string") {
      return;
    }
    const parsed = JSON.parse(plan.next) as {
      mcpServers: Record<string, unknown>;
      other: boolean;
    };
    expect(parsed.other).toBe(true);
    expect(parsed.mcpServers.mine).toBeDefined();
    expect(parsed.mcpServers["pier-memory"]).toEqual(buildServerEntry(STORE));
  });

  it("rejects foreign pier-memory key", () => {
    const foreign = {
      mcpServers: { "pier-memory": { command: "someone-else" } },
    };
    const plan = planJsonUpsert(JSON.stringify(foreign), STORE);
    expect(plan.ok).toBe(false);
  });

  it("removes only own entry and reports null next for empty skeleton", () => {
    const first = planJsonUpsert(null, STORE);
    if (!first.ok || typeof first.next !== "string") {
      throw new Error("setup failed");
    }
    const removed = planRemove(first.next, "mcp-servers-json");
    expect(removed.ok).toBe(true);
    if (!removed.ok) {
      return;
    }
    expect(removed.next).toBeNull();
  });

  it("slice fingerprint matches upsert fingerprint", () => {
    const plan = planJsonUpsert(null, STORE);
    expect(plan.ok).toBe(true);
    if (!plan.ok || typeof plan.next !== "string") {
      return;
    }
    expect(fingerprintManagedSlice(plan.next, "mcp-servers-json")).toBe(
      plan.fingerprint
    );
  });
});

describe("opencode-json upsert", () => {
  it("uses local schema: type/command-array/environment", () => {
    const plan = planOpenCodeUpsert(null, STORE);
    expect(plan.ok).toBe(true);
    if (!plan.ok || typeof plan.next !== "string") {
      return;
    }
    expect(JSON.parse(plan.next)).toEqual({
      mcp: {
        "pier-memory": {
          command: ["npx", "-y", "@modelcontextprotocol/server-memory@0.6.3"],
          environment: { MEMORY_FILE_PATH: STORE },
          type: "local",
        },
      },
    });
  });
});

describe("codex-toml append/remove", () => {
  it("appends marker block and validates with smol-toml", () => {
    const plan = planTomlAppend("", STORE);
    expect(plan.ok).toBe(true);
    if (!plan.ok) {
      return;
    }
    expect(plan.next).toContain("# pier-managed:pier-memory begin");
    expect(plan.next).toContain("[mcp_servers.pier-memory]");
  });

  it("rejects when pier-memory already defined in any form", () => {
    const existing = 'foo = 1\n[mcp_servers."pier-memory"]\ncommand = "x"\n';
    expect(planTomlAppend(existing, STORE).ok).toBe(false);
    const inline = 'mcp_servers = { "pier-memory" = { command = "x" } }\n';
    expect(planTomlAppend(inline, STORE).ok).toBe(false);
    const broken = "[unclosed\n";
    expect(planTomlAppend(broken, STORE).ok).toBe(false);
  });

  it("remove restores bytes outside marker block", () => {
    const head = "# my config\nfoo = 1\n";
    const appended = planTomlAppend(head, STORE);
    if (!appended.ok || typeof appended.next !== "string") {
      throw new Error("setup failed");
    }
    const removed = planRemove(appended.next, "codex-toml");
    expect(removed.ok).toBe(true);
    if (!removed.ok || typeof removed.next !== "string") {
      return;
    }
    expect(removed.next).toBe(head);
  });
});
