import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();
const SPEC = "docs/superpowers/specs/2026-09-03-mcp-inventory-gold-standard.md";
const AGENTS = "AGENTS.md";
const CONTRACT = "src/shared/contracts/agent/assets.ts";
const CHIPS =
  "src/renderer/pages/settings/components/project/mcp-agent-chips.tsx";
const PANEL = "src/renderer/pages/settings/components/project/mcp-panel.tsx";
const ROW = "src/renderer/pages/settings/components/project/mcp-server-row.tsx";
const DECLS = "src/main/services/agent-mcp-catalog/parse-server-decls.ts";
const SERVICE = "src/main/services/agent-mcp-catalog/service.ts";
const GROUP_VIEW = "src/plugins/builtin/files/renderer/panel/group-view.tsx";

function read(rel: string): string {
  return readFileSync(join(ROOT, rel), "utf8");
}

describe("MCP inventory gold standard", () => {
  it("documents the contract in AGENTS.md and the spec", () => {
    const agents = read(AGENTS);
    const spec = read(SPEC);
    expect(existsSync(join(ROOT, SPEC))).toBe(true);
    expect(agents).toContain("### MCP 跨智能体清单");
    expect(agents).toContain(
      "tests/unit/renderer/settings/mcp-inventory-governance.test.ts"
    );
    expect(agents).toContain("tests/unit/renderer/settings/mcp-panel.test.tsx");
    expect(spec).toContain("一句话终态");
    expect(spec).toContain("清单，不是控制台");
    expect(spec).toContain("谁能用必须可读");
    expect(spec).toContain("PIER_MANAGED_MCP_SERVER_NAME");
    expect(spec).toContain("pier.memory.project");
    expect(spec).toContain("不启动这些服务器");
  });

  it("keeps catalog snapshots free of secret payloads", () => {
    const contract = read(CONTRACT);
    expect(contract).toContain('PIER_MANAGED_MCP_SERVER_NAME = "pier-memory"');
    expect(contract).toContain("mcpTransportSchema");
    expect(contract).toContain("mcpOwnershipSchema");
    const listingBlock = contract.slice(
      contract.indexOf("mcpServerListingSchema"),
      contract.indexOf("export type McpServerListing")
    );
    expect(listingBlock).not.toContain("command");
    expect(listingBlock).not.toMatch(/\benv\b/);
    const decls = read(DECLS);
    expect(decls).toContain("Never returns command/args/env/url/headers");
    expect(decls).not.toContain("return { command");
    const service = read(SERVICE);
    expect(service).not.toContain("tools/list");
    expect(service).not.toContain("spawn(");
  });

  it("requires labeled agent chips and pier-memory tab jump", () => {
    const chips = read(CHIPS);
    expect(chips).toContain("AgentIcon");
    expect(chips).toContain("agentLabel(cell.agentKind)");
    expect(chips).not.toContain("StatusIcon");
    const row = read(ROW);
    expect(row).toContain(
      'MEMORY_PROJECT_SETTINGS_TAB = "pier.memory.project"'
    );
    expect(row).toContain("mcpOpenMemory");
    expect(row).toContain("listing.displayPath");
    expect(row).toContain("primaryDisplayPath");
    expect(row).not.toContain("StatusIcon");
    const groupView = read(GROUP_VIEW);
    expect(groupView).toContain("OutsideWorkspaceBanner");
    expect(groupView).toContain("ResolvedFilePanel");
    expect(groupView).not.toMatch(
      /if \(outsideWorkspace && selectedSource\) \{\s*center =/
    );
    const panel = read(PANEL);
    expect(panel).toContain("setProjectsTab(MEMORY_PROJECT_SETTINGS_TAB)");
    expect(panel).toContain("openUnderRootInPierEditor");
    expect(panel).toContain("mcpGroupPier");
    expect(read(DECLS)).toContain("streamable_http");
    expect(read(DECLS)).toContain('"builtin"');
    expect(panel).not.toContain("spawn");
    expect(panel).not.toContain("StatusIcon");
    expect(panel).not.toMatch(/variant=["']success["']/);
  });
});
