import {
  type McpDiscoveryAdapter,
  mcpProject,
  mcpUser,
} from "./adapter-facts.ts";

/** Original v1 MCP consumers plus Grok (same TOML `[mcp_servers.name]` as Codex). */
export const MCP_CORE_ADAPTERS: readonly McpDiscoveryAdapter[] = [
  {
    agentKind: "claude",
    consumesMcp: true,
    projectConfigs: [mcpProject(".mcp.json")],
    userConfigs: [mcpUser(".claude.json", "claude-user-json")],
    officialDocsUrl: "https://code.claude.com/docs/en/mcp",
    verifiedOn: "2026-07-24",
  },
  {
    agentKind: "cursor",
    consumesMcp: true,
    projectConfigs: [mcpProject(".cursor/mcp.json")],
    userConfigs: [mcpUser(".cursor/mcp.json")],
    officialDocsUrl: "https://cursor.com/docs/context/mcp",
    verifiedOn: "2026-07-24",
  },
  {
    agentKind: "codex",
    consumesMcp: true,
    projectConfigs: [mcpProject(".codex/config.toml", "codex-toml")],
    userConfigs: [
      mcpUser(".codex/config.toml", "codex-toml", {
        envRelative: "config.toml",
        homeEnv: "CODEX_HOME",
      }),
    ],
    officialDocsUrl: "https://developers.openai.com/codex/mcp",
    verifiedOn: "2026-07-24",
  },
  {
    agentKind: "opencode",
    consumesMcp: true,
    projectConfigs: [mcpProject("opencode.json", "opencode-json")],
    userConfigs: [
      mcpUser(".config/opencode/opencode.json", "opencode-json", {
        envRelative: "opencode/opencode.json",
        homeEnv: "XDG_CONFIG_HOME",
        jsoncSibling: true,
      }),
    ],
    officialDocsUrl: "https://opencode.ai/docs/mcp-servers",
    verifiedOn: "2026-07-24",
  },
  {
    agentKind: "gemini",
    consumesMcp: true,
    projectConfigs: [mcpProject(".gemini/settings.json")],
    userConfigs: [mcpUser(".gemini/settings.json")],
    officialDocsUrl: "https://geminicli.com/docs/tools/mcp-server/",
    verifiedOn: "2026-07-24",
  },
  {
    agentKind: "omp",
    consumesMcp: true,
    projectConfigs: [
      mcpProject(".omp/mcp.json"),
      mcpProject(".mcp.json"),
      mcpProject("mcp.json"),
      mcpProject(".cursor/mcp.json"),
      mcpProject("opencode.json", "opencode-json"),
    ],
    userConfigs: [
      mcpUser(".omp/agent/mcp.json"),
      mcpUser(".cursor/mcp.json"),
      mcpUser(".config/opencode/opencode.json", "opencode-json"),
    ],
    officialDocsUrl: "https://omp.sh/docs/mcp",
    verifiedOn: "2026-07-24",
  },
  {
    agentKind: "grok",
    consumesMcp: true,
    projectConfigs: [mcpProject(".grok/config.toml", "codex-toml")],
    userConfigs: [
      mcpUser(".grok/config.toml", "codex-toml", {
        envRelative: "config.toml",
        homeEnv: "GROK_HOME",
      }),
    ],
    officialDocsUrl: "https://x.ai/docs/build/features/mcp-servers",
    verifiedOn: "2026-08-30",
  },
];
