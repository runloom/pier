import {
  type McpDiscoveryAdapter,
  mcpProject,
  mcpUser,
} from "./adapter-facts.ts";

/** Additional MCP consumers whose user config uses a writable memory format. */
export const MCP_EXTENDED_ADAPTERS: readonly McpDiscoveryAdapter[] = [
  {
    agentKind: "openclaude",
    consumesMcp: true,
    projectConfigs: [mcpProject(".mcp.json")],
    userConfigs: [mcpUser(".claude.json", "claude-user-json")],
    officialDocsUrl: "https://openclaude.gitlawb.com/docs/skills/",
    verifiedOn: "2026-08-30",
  },
  {
    agentKind: "copilot",
    consumesMcp: true,
    projectConfigs: [mcpProject(".mcp.json"), mcpProject(".github/mcp.json")],
    userConfigs: [mcpUser(".copilot/mcp-config.json")],
    officialDocsUrl:
      "https://docs.github.com/en/copilot/how-tos/copilot-cli/customize-copilot/add-mcp-servers",
    verifiedOn: "2026-08-30",
  },
  {
    agentKind: "droid",
    consumesMcp: true,
    projectConfigs: [mcpProject(".factory/mcp.json")],
    userConfigs: [mcpUser(".factory/mcp.json")],
    officialDocsUrl: "https://docs.factory.ai/harness/mcp",
    verifiedOn: "2026-08-30",
  },
  {
    agentKind: "kimi",
    consumesMcp: true,
    projectConfigs: [mcpProject(".kimi-code/mcp.json")],
    userConfigs: [
      mcpUser(".kimi-code/mcp.json", "json-mcp-servers", {
        envRelative: "mcp.json",
        homeEnv: "KIMI_CODE_HOME",
      }),
    ],
    officialDocsUrl:
      "https://www.kimi.com/code/docs/kimi-code-cli/customization/mcp.html",
    verifiedOn: "2026-08-30",
  },
  {
    agentKind: "kilo",
    consumesMcp: true,
    projectConfigs: [
      mcpProject("kilo.json", "opencode-json"),
      mcpProject(".kilo/kilo.json", "opencode-json"),
    ],
    userConfigs: [
      mcpUser(".config/kilo/kilo.json", "opencode-json", {
        envRelative: "kilo/kilo.json",
        homeEnv: "XDG_CONFIG_HOME",
        jsoncSibling: true,
      }),
    ],
    officialDocsUrl: "https://kilo.ai/docs/automate/mcp/using-in-cli",
    verifiedOn: "2026-08-30",
  },
  {
    agentKind: "kiro",
    consumesMcp: true,
    projectConfigs: [mcpProject(".kiro/settings/mcp.json")],
    userConfigs: [mcpUser(".kiro/settings/mcp.json")],
    officialDocsUrl: "https://kiro.dev/docs/cli/mcp/",
    verifiedOn: "2026-08-30",
  },
  {
    agentKind: "cline",
    consumesMcp: true,
    projectConfigs: [],
    userConfigs: [
      mcpUser(
        ".cline/data/settings/cline_mcp_settings.json",
        "json-mcp-servers",
        {
          envRelative: "data/settings/cline_mcp_settings.json",
          homeEnv: "CLINE_DIR",
        }
      ),
    ],
    officialDocsUrl: "https://docs.cline.bot/cline-cli/configuration",
    verifiedOn: "2026-08-30",
  },
  {
    agentKind: "qwen-code",
    consumesMcp: true,
    projectConfigs: [mcpProject(".qwen/settings.json")],
    userConfigs: [mcpUser(".qwen/settings.json")],
    officialDocsUrl:
      "https://qwenlm.github.io/qwen-code-docs/en/users/features/mcp/",
    verifiedOn: "2026-08-30",
  },
  {
    agentKind: "aug",
    consumesMcp: true,
    projectConfigs: [mcpProject(".augment/settings.json")],
    userConfigs: [mcpUser(".augment/settings.json")],
    officialDocsUrl: "https://docs.augmentcode.com/cli/integrations",
    verifiedOn: "2026-08-30",
  },
  {
    agentKind: "codebuddy",
    consumesMcp: true,
    projectConfigs: [mcpProject(".mcp.json")],
    userConfigs: [mcpUser(".codebuddy/.mcp.json")],
    officialDocsUrl: "https://www.codebuddy.ai/docs/cli/mcp",
    verifiedOn: "2026-08-30",
  },
  {
    agentKind: "crush",
    consumesMcp: true,
    projectConfigs: [mcpProject("crush.json", "opencode-json")],
    userConfigs: [
      mcpUser(".config/crush/crush.json", "opencode-json", {
        envRelative: "crush/crush.json",
        homeEnv: "XDG_CONFIG_HOME",
        jsoncSibling: true,
      }),
    ],
    officialDocsUrl: "https://github.com/charmbracelet/crush",
    verifiedOn: "2026-08-30",
  },
  {
    agentKind: "continue",
    consumesMcp: true,
    projectConfigs: [mcpProject(".continue/mcpServers/mcp.json")],
    userConfigs: [mcpUser(".continue/mcpServers/pier-memory.json")],
    officialDocsUrl: "https://docs.continue.dev/customize/deep-dives/mcp",
    verifiedOn: "2026-08-30",
  },
  {
    agentKind: "amp",
    consumesMcp: true,
    projectConfigs: [mcpProject(".amp/settings.json", "amp-settings-json")],
    userConfigs: [
      mcpUser(".config/amp/settings.json", "amp-settings-json", {
        envRelative: "amp/settings.json",
        homeEnv: "XDG_CONFIG_HOME",
      }),
    ],
    officialDocsUrl: "https://ampcode.com/manual/mcp.md",
    verifiedOn: "2026-08-30",
  },
  {
    agentKind: "goose",
    consumesMcp: true,
    projectConfigs: [],
    userConfigs: [
      mcpUser(".config/goose/config.yaml", "goose-yaml", {
        envRelative: "goose/config.yaml",
        homeEnv: "XDG_CONFIG_HOME",
      }),
    ],
    officialDocsUrl:
      "https://block.github.io/goose/docs/guides/config-files.md",
    verifiedOn: "2026-08-30",
  },
  {
    agentKind: "hermes",
    consumesMcp: true,
    projectConfigs: [],
    userConfigs: [mcpUser(".hermes/config.yaml", "hermes-yaml")],
    officialDocsUrl:
      "https://hermes-agent.nousresearch.com/docs/reference/mcp-config-reference",
    verifiedOn: "2026-08-30",
  },
  {
    agentKind: "mistral-vibe",
    consumesMcp: true,
    projectConfigs: [mcpProject(".vibe/config.toml", "vibe-toml")],
    userConfigs: [mcpUser(".vibe/config.toml", "vibe-toml")],
    officialDocsUrl: "https://docs.mistral.ai/vibe/code/cli/mcp-servers",
    verifiedOn: "2026-08-30",
  },
  {
    agentKind: "qodercli",
    consumesMcp: true,
    projectConfigs: [
      mcpProject(".qoder/settings.json"),
      mcpProject(".mcp.json"),
    ],
    userConfigs: [mcpUser(".qoder/settings.json")],
    officialDocsUrl: "https://docs.qoder.com/cli/mcp-servers",
    verifiedOn: "2026-08-30",
  },
  {
    agentKind: "antigravity",
    consumesMcp: true,
    projectConfigs: [mcpProject(".agents/mcp_config.json")],
    userConfigs: [mcpUser(".gemini/config/mcp_config.json")],
    officialDocsUrl: "https://antigravity.google/docs/mcp",
    verifiedOn: "2026-08-30",
  },
  {
    agentKind: "rovo",
    consumesMcp: true,
    projectConfigs: [mcpProject(".rovodev/mcp.json")],
    userConfigs: [mcpUser(".rovodev/mcp.json")],
    officialDocsUrl:
      "https://support.atlassian.com/rovo/docs/connect-to-an-mcp-server-in-rovo-dev-cli/",
    verifiedOn: "2026-08-30",
  },
];
