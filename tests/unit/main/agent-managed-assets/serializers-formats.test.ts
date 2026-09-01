import {
  buildGooseLauncherEntry,
  buildLauncherEntry,
  fingerprintManagedSlice,
  inferMemoryFormat,
  planMemoryUpsert,
  planRemove,
} from "@main/services/agent-managed-assets/serializers.ts";
import { parse as parseToml } from "smol-toml";
import { describe, expect, it } from "vitest";

const LAUNCHER = "/abs/.pier/memory/launcher/current/memory-mcp.mjs";

describe("amp / goose / hermes / vibe serializers", () => {
  it("writes Amp dotted amp.mcpServers key", () => {
    const entry = buildLauncherEntry(LAUNCHER);
    const plan = planMemoryUpsert("amp-settings-json", null, entry);
    expect(plan.ok).toBe(true);
    if (!(plan.ok && typeof plan.next === "string")) {
      return;
    }
    const parsed = JSON.parse(plan.next) as {
      "amp.mcpServers": Record<string, unknown>;
    };
    expect(parsed["amp.mcpServers"]["pier-memory"]).toEqual(entry);
    expect(fingerprintManagedSlice(plan.next, "amp-settings-json")).toBe(
      plan.fingerprint
    );
  });

  it("keeps Goose comments and sibling keys through upsert and remove", () => {
    const prior = `# GOOSE_PROVIDER is anthropic
GOOSE_PROVIDER: anthropic
extensions:
  filesystem:
    type: stdio
    cmd: npx
`;
    const entry = buildGooseLauncherEntry(LAUNCHER);
    const plan = planMemoryUpsert("goose-yaml", prior, entry);
    expect(plan.ok).toBe(true);
    if (!(plan.ok && typeof plan.next === "string")) {
      return;
    }
    expect(plan.next).toContain("# GOOSE_PROVIDER is anthropic");
    expect(plan.next).toContain("GOOSE_PROVIDER:");
    expect(plan.next).toContain("filesystem:");
    expect(plan.next).toContain("cmd: node");
    expect(fingerprintManagedSlice(plan.next, "goose-yaml")).toBe(
      plan.fingerprint
    );
    const removed = planRemove(plan.next, "goose-yaml");
    expect(removed.ok).toBe(true);
    if (removed.ok && typeof removed.next === "string") {
      expect(removed.next).toContain("# GOOSE_PROVIDER is anthropic");
      expect(removed.next).toContain("filesystem:");
      expect(removed.next).not.toContain("pier-memory");
    }
  });

  it("merges Goose extensions without clobbering siblings", () => {
    const prior = "extensions:\n  filesystem:\n    type: stdio\n    cmd: npx\n";
    const entry = buildGooseLauncherEntry(LAUNCHER);
    const plan = planMemoryUpsert("goose-yaml", prior, entry);
    expect(plan.ok).toBe(true);
    if (!(plan.ok && typeof plan.next === "string")) {
      return;
    }
    expect(plan.next).toContain("filesystem:");
    expect(plan.next).toContain("cmd: node");
    expect(fingerprintManagedSlice(plan.next, "goose-yaml")).toBe(
      plan.fingerprint
    );
    const removed = planRemove(plan.next, "goose-yaml");
    expect(removed.ok).toBe(true);
    if (removed.ok) {
      expect(removed.next).toContain("filesystem:");
      expect(removed.next).not.toContain("pier-memory");
    }
  });

  it("writes Hermes mcp_servers mapping", () => {
    const entry = buildLauncherEntry(LAUNCHER);
    const plan = planMemoryUpsert("hermes-yaml", null, entry);
    expect(plan.ok).toBe(true);
    if (!(plan.ok && typeof plan.next === "string")) {
      return;
    }
    expect(plan.next).toContain("mcp_servers:");
    expect(plan.next).toContain("pier-memory:");
    expect(fingerprintManagedSlice(plan.next, "hermes-yaml")).toBe(
      plan.fingerprint
    );
  });

  it("replaces stock vibe mcp_servers = [] so the file stays valid TOML", () => {
    const prior = 'mcp_servers = []\nactive_model = "codestral-latest"\n';
    const entry = buildLauncherEntry(LAUNCHER);
    const plan = planMemoryUpsert("vibe-toml", prior, entry);
    expect(plan.ok).toBe(true);
    if (!(plan.ok && typeof plan.next === "string")) {
      return;
    }
    expect(plan.next).not.toMatch(/mcp_servers\s*=\s*\[/u);
    expect(plan.next).toContain("[[mcp_servers]]");
    expect(plan.next).toContain('name = "pier-memory"');
    expect(plan.next).toContain("codestral-latest");
    const parsed = parseToml(plan.next) as {
      active_model?: string;
      mcp_servers?: { name?: string }[];
    };
    expect(parsed.active_model).toBe("codestral-latest");
    expect(
      parsed.mcp_servers?.some((item) => item.name === "pier-memory")
    ).toBe(true);
  });

  it("refuses vibe named [mcp_servers.*] tables", () => {
    const plan = planMemoryUpsert(
      "vibe-toml",
      '[mcp_servers.foo]\ncommand = "x"\n',
      buildLauncherEntry(LAUNCHER)
    );
    expect(plan.ok).toBe(false);
  });

  it("appends Vibe [[mcp_servers]] array tables with a marker", () => {
    const prior = '[[mcp_servers]]\nname = "other"\ncommand = "x"\n';
    const entry = buildLauncherEntry(LAUNCHER);
    const plan = planMemoryUpsert("vibe-toml", prior, entry);
    expect(plan.ok).toBe(true);
    if (!(plan.ok && typeof plan.next === "string")) {
      return;
    }
    expect(plan.next).toContain('name = "other"');
    expect(plan.next).toContain("[[mcp_servers]]");
    expect(plan.next).toContain('name = "pier-memory"');
    expect(plan.next).toContain('transport = "stdio"');
    expect(fingerprintManagedSlice(plan.next, "vibe-toml")).toBe(
      plan.fingerprint
    );
  });

  it("adopts an equivalent unmarked vibe [[mcp_servers]] item", () => {
    const prior = [
      'active_model = "codestral-latest"',
      "",
      "[[mcp_servers]]",
      'name = "pier-memory"',
      'command = "node"',
      `args = [${JSON.stringify(LAUNCHER)}]`,
      "",
    ].join("\n");
    const plan = planMemoryUpsert(
      "vibe-toml",
      prior,
      buildLauncherEntry(LAUNCHER)
    );
    expect(plan.ok).toBe(true);
    if (!(plan.ok && typeof plan.next === "string")) {
      return;
    }
    expect(plan.next).toContain("codestral-latest");
    expect(plan.next).toContain("# pier-managed:pier-memory begin");
    expect(plan.next.match(/\[\[mcp_servers\]\]/g)).toHaveLength(1);
  });

  it("refuses extra keys on an otherwise equivalent vibe item", () => {
    const prior = [
      "[[mcp_servers]]",
      'name = "pier-memory"',
      'command = "node"',
      `args = [${JSON.stringify(LAUNCHER)}]`,
      'url = "http://example"',
      "",
    ].join("\n");
    expect(
      planMemoryUpsert("vibe-toml", prior, buildLauncherEntry(LAUNCHER)).ok
    ).toBe(false);
  });

  it("infers extra formats from path", () => {
    expect(inferMemoryFormat("/home/u/.vibe/config.toml")).toBe("vibe-toml");
    expect(inferMemoryFormat("/home/u/.grok/config.toml")).toBe("codex-toml");
    expect(inferMemoryFormat("/xdg/goose/config.yaml")).toBe("goose-yaml");
    expect(inferMemoryFormat("/home/u/.hermes/config.yaml")).toBe(
      "hermes-yaml"
    );
    expect(inferMemoryFormat("/xdg/amp/settings.json")).toBe(
      "amp-settings-json"
    );
  });
});
