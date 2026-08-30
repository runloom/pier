import type { AgentKind } from "@shared/contracts/agent.ts";
import type { McpDiscoveryAdapter } from "./adapter-facts.ts";

function none(
  agentKind: AgentKind,
  officialDocsUrl: string
): McpDiscoveryAdapter {
  return {
    agentKind,
    consumesMcp: false,
    officialDocsUrl,
    projectConfigs: [],
    userConfigs: [],
    verifiedOn: "2026-08-30",
  };
}

/**
 * Products with no official user-level MCP client config. This list is only
 * "does not consume MCP" — never "serializer not written yet".
 */
export const MCP_NONE_ADAPTERS: readonly McpDiscoveryAdapter[] = [
  none("aider", "https://aider.chat/docs/"),
  none("ante", "https://github.com/AntigmaLabs/ante-preview"),
  none("autohand", "https://github.com/autohandai/code-cli"),
  none("codebuff", "https://www.codebuff.com/docs/help/quick-start"),
  none("command-code", "https://commandcode.ai/docs/quickstart"),
  none("devin", "https://devin.ai/cli"),
  none("mimo-code", "https://mimo.xiaomi.com/coder"),
  none("openclaw", "https://github.com/openclaw/openclaw"),
  none("pi", "https://pi.dev"),
];
