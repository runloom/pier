import {
  buildLauncherEntry,
  buildOpenCodeEntry,
  buildOpenCodeLauncherEntry,
  buildServerEntry,
  fingerprintManagedSlice,
  inferMemoryFormat,
  planJsonUpsert,
  planOpenCodeUpsert,
  planRemove,
  planTomlAppend,
} from "@main/services/agent-managed-assets/serializers.ts";
import { describe, expect, it } from "vitest";

const STORE = "/home/u/.p/pier.memory/abc123/memory.jsonl";
const MOVED_STORE = "/home/u/.pier/memory/abc123/memory.jsonl";

describe("owned-entry rewrite (store move / engine bump)", () => {
  it("json: rewrites its own entry when the ledger fingerprint matches", () => {
    const first = planJsonUpsert(null, buildServerEntry(STORE));
    if (!(first.ok && typeof first.next === "string")) {
      throw new Error("expected first plan");
    }
    const moved = planJsonUpsert(
      first.next,
      buildServerEntry(MOVED_STORE),
      first.fingerprint
    );
    expect(moved.ok).toBe(true);
    if (!(moved.ok && typeof moved.next === "string")) {
      return;
    }
    expect(moved.next).toContain(MOVED_STORE);
    expect(moved.next).not.toContain(STORE);
  });

  it("json: still rejects foreign entries when the fingerprint mismatches", () => {
    const raw = JSON.stringify({
      mcpServers: { "pier-memory": { command: "someone-else" } },
    });
    const plan = planJsonUpsert(
      raw,
      buildServerEntry(MOVED_STORE),
      "not-the-foreign-sha"
    );
    expect(plan.ok).toBe(false);
  });

  it("toml: replaces its own marker block in place", () => {
    const first = planTomlAppend("# user comment\n", buildServerEntry(STORE));
    if (!(first.ok && typeof first.next === "string")) {
      throw new Error("expected first plan");
    }
    const moved = planTomlAppend(
      first.next,
      buildServerEntry(MOVED_STORE),
      first.fingerprint
    );
    expect(moved.ok).toBe(true);
    if (!(moved.ok && typeof moved.next === "string")) {
      return;
    }
    expect(moved.next).toContain(MOVED_STORE);
    expect(moved.next).not.toContain(STORE);
    expect(moved.next).toContain("# user comment");
    expect(moved.next.match(/pier-managed:pier-memory begin/g)).toHaveLength(1);
  });

  it("toml: adopts an equivalent unmarked table and wraps it in markers", () => {
    const launcher = "/abs/.pier/memory/launcher/current/memory-mcp.mjs";
    const existing = [
      "[cli]",
      'installer = "internal"',
      "",
      "[mcp_servers.pier-memory]",
      'command = "node"',
      `args = [${JSON.stringify(launcher)}]`,
      "",
    ].join("\n");
    const plan = planTomlAppend(existing, buildLauncherEntry(launcher));
    expect(plan.ok).toBe(true);
    if (!(plan.ok && typeof plan.next === "string")) {
      return;
    }
    expect(plan.next).toContain("[cli]");
    expect(plan.next).toContain("# pier-managed:pier-memory begin");
    expect(plan.next.match(/\[mcp_servers\.pier-memory\]/g)).toHaveLength(1);
    expect(plan.next).toContain(launcher);
  });

  it("toml: adopts an equivalent table sitting between other tables", () => {
    const launcher = "/abs/.pier/memory/launcher/current/memory-mcp.mjs";
    const existing = [
      "[cli]",
      'installer = "internal"',
      "",
      "[mcp_servers.pier-memory]",
      'command = "node"',
      `args = [${JSON.stringify(launcher)}]`,
      "",
      "[ui]",
      'theme = "auto"',
      "",
    ].join("\n");
    const plan = planTomlAppend(existing, buildLauncherEntry(launcher));
    expect(plan.ok).toBe(true);
    if (!(plan.ok && typeof plan.next === "string")) {
      return;
    }
    expect(plan.next).toContain("[cli]");
    expect(plan.next).toContain("[ui]");
    expect(plan.next).toContain('theme = "auto"');
    expect(plan.next.match(/\[mcp_servers\.pier-memory\]/g)).toHaveLength(1);
    expect(plan.next).toContain("# pier-managed:pier-memory begin");
  });

  it("toml: refuses extra keys on an otherwise equivalent table", () => {
    const launcher = "/abs/.pier/memory/launcher/current/memory-mcp.mjs";
    const existing = [
      "[mcp_servers.pier-memory]",
      'command = "node"',
      `args = [${JSON.stringify(launcher)}]`,
      "timeout = 60",
      "",
    ].join("\n");
    expect(planTomlAppend(existing, buildLauncherEntry(launcher)).ok).toBe(
      false
    );
  });

  it("toml: keeps refusing foreign definitions", () => {
    const raw = '[mcp_servers.pier-memory]\ncommand = "someone-else"\n';
    const plan = planTomlAppend(raw, buildServerEntry(MOVED_STORE), "mismatch");
    expect(plan.ok).toBe(false);
  });
});

describe("mcp-servers-json upsert", () => {
  it("creates skeleton when file missing", () => {
    const plan = planJsonUpsert(null, buildServerEntry(STORE));
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
    const plan = planJsonUpsert(raw, buildServerEntry(STORE));
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
    const plan = planJsonUpsert(
      JSON.stringify(foreign),
      buildServerEntry(STORE)
    );
    expect(plan.ok).toBe(false);
  });

  it("removes only own entry and reports null next for empty skeleton", () => {
    const first = planJsonUpsert(null, buildServerEntry(STORE));
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
    const plan = planJsonUpsert(null, buildServerEntry(STORE));
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
    const plan = planOpenCodeUpsert(null, buildOpenCodeEntry(STORE));
    expect(plan.ok).toBe(true);
    if (!plan.ok || typeof plan.next !== "string") {
      return;
    }
    expect(JSON.parse(plan.next)).toEqual({
      mcp: {
        "pier-memory": {
          command: [
            "npx",
            "-y",
            "@modelcontextprotocol/server-memory@2026.7.4",
          ],
          environment: { MEMORY_FILE_PATH: STORE },
          type: "local",
        },
      },
    });
  });

  it("edits JSONC in place and keeps comments", () => {
    const raw = `{
  // keep this
  "$schema": "https://opencode.ai/config.json",
}
`;
    const plan = planOpenCodeUpsert(
      raw,
      buildOpenCodeLauncherEntry("/abs/launcher.js")
    );
    expect(plan.ok).toBe(true);
    if (!plan.ok || typeof plan.next !== "string") {
      return;
    }
    expect(plan.next).toContain("// keep this");
    expect(plan.next).toContain("$schema");
    expect(plan.next).toContain("pier-memory");
    expect(fingerprintManagedSlice(plan.next, "opencode-json")).toBe(
      plan.fingerprint
    );
    const removed = planRemove(plan.next, "opencode-json");
    expect(removed.ok).toBe(true);
    if (!removed.ok || typeof removed.next !== "string") {
      return;
    }
    expect(removed.next).toContain("// keep this");
    expect(removed.next).not.toContain("pier-memory");
  });

  it("keeps comment-only leftovers instead of deleting the file", () => {
    const raw = `{
  // user config
}
`;
    const plan = planOpenCodeUpsert(
      raw,
      buildOpenCodeLauncherEntry("/abs/launcher.js")
    );
    expect(plan.ok).toBe(true);
    if (!plan.ok || typeof plan.next !== "string") {
      return;
    }
    const removed = planRemove(plan.next, "opencode-json");
    expect(removed.ok).toBe(true);
    if (!removed.ok) {
      return;
    }
    expect(removed.next).toEqual(expect.stringContaining("// user config"));
    expect(removed.next).not.toContain("pier-memory");
  });

  it("still collapses a Pier-created skeleton to null", () => {
    const plan = planOpenCodeUpsert(
      null,
      buildOpenCodeLauncherEntry("/abs/launcher.js")
    );
    expect(plan.ok).toBe(true);
    if (!plan.ok || typeof plan.next !== "string") {
      return;
    }
    const removed = planRemove(plan.next, "opencode-json");
    expect(removed.ok).toBe(true);
    if (!removed.ok) {
      return;
    }
    expect(removed.next).toBeNull();
  });

  it("fails closed when mcp is not an object", () => {
    const plan = planOpenCodeUpsert(
      `{ "mcp": [] }`,
      buildOpenCodeLauncherEntry("/abs/launcher.js")
    );
    expect(plan.ok).toBe(false);
    if (plan.ok) {
      return;
    }
    expect(plan.reason).toContain("mcp is not an object");
  });

  it("rejects a foreign pier-memory key in JSONC", () => {
    const raw = `{
  // keep
  "mcp": { "pier-memory": { "command": ["x"], "type": "local" } }
}
`;
    const plan = planOpenCodeUpsert(
      raw,
      buildOpenCodeLauncherEntry("/abs/launcher.js")
    );
    expect(plan.ok).toBe(false);
  });

  it("treats opencode.jsonc as the opencode format", () => {
    expect(inferMemoryFormat("/xdg/opencode/opencode.jsonc")).toBe(
      "opencode-json"
    );
    expect(inferMemoryFormat("/xdg/opencode/opencode.json")).toBe(
      "opencode-json"
    );
    expect(inferMemoryFormat("/xdg/kilo/kilo.json")).toBe("opencode-json");
    expect(inferMemoryFormat("/xdg/crush/crush.jsonc")).toBe("opencode-json");
  });
});

describe("codex-toml append/remove", () => {
  it("appends marker block and validates with smol-toml", () => {
    const plan = planTomlAppend("", buildServerEntry(STORE));
    expect(plan.ok).toBe(true);
    if (!plan.ok) {
      return;
    }
    expect(plan.next).toContain("# pier-managed:pier-memory begin");
    expect(plan.next).toContain("[mcp_servers.pier-memory]");
  });

  it("rejects when pier-memory already defined in any form", () => {
    const existing = 'foo = 1\n[mcp_servers."pier-memory"]\ncommand = "x"\n';
    expect(planTomlAppend(existing, buildServerEntry(STORE)).ok).toBe(false);
    const inline = 'mcp_servers = { "pier-memory" = { command = "x" } }\n';
    expect(planTomlAppend(inline, buildServerEntry(STORE)).ok).toBe(false);
    const broken = "[unclosed\n";
    expect(planTomlAppend(broken, buildServerEntry(STORE)).ok).toBe(false);
  });

  it("remove restores bytes outside marker block", () => {
    const head = "# my config\nfoo = 1\n";
    const appended = planTomlAppend(head, buildServerEntry(STORE));
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
