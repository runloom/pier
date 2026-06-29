import type { AgentCatalogEntry, AgentKind } from "@shared/contracts/agent.ts";

export const AGENT_CATALOG: readonly AgentCatalogEntry[] = [
  {
    id: "claude",
    label: "Claude",
    launchCmd: "claude",
    detectCmd: "claude",
    expectedProcess: "claude",
    iconId: "claude",
    homepageUrl: "https://claude.com/claude-code",
  },
  {
    id: "codex",
    label: "Codex",
    launchCmd: "codex",
    detectCmd: "codex",
    expectedProcess: "codex",
    iconId: "codex",
    homepageUrl: "https://developers.openai.com/codex",
  },
  {
    id: "gemini",
    label: "Gemini",
    launchCmd: "gemini",
    detectCmd: "gemini",
    expectedProcess: "gemini",
    faviconDomain: "gemini.google.com",
  },
  {
    id: "aider",
    label: "Aider",
    launchCmd: "aider",
    detectCmd: "aider",
    expectedProcess: "aider",
    iconId: "aider",
    faviconDomain: "aider.chat",
  },
  {
    id: "opencode",
    label: "OpenCode",
    launchCmd: "opencode",
    detectCmd: "opencode",
    expectedProcess: "opencode",
    faviconDomain: "opencode.ai",
  },
  {
    id: "cursor",
    label: "Cursor",
    launchCmd: "cursor-agent",
    detectCmd: "cursor-agent",
    expectedProcess: "cursor-agent",
    faviconDomain: "cursor.com",
  },
  {
    id: "copilot",
    label: "Copilot",
    launchCmd: "copilot",
    detectCmd: "copilot",
    expectedProcess: "copilot",
    iconId: "copilot",
    faviconDomain: "github.com",
  },
  {
    id: "droid",
    label: "Droid",
    launchCmd: "droid",
    detectCmd: "droid",
    expectedProcess: "droid",
    iconId: "droid",
    faviconDomain: "factory.ai",
  },
  {
    id: "kimi",
    label: "Kimi",
    launchCmd: "kimi",
    detectCmd: "kimi",
    expectedProcess: "kimi",
    faviconDomain: "moonshot.cn",
  },
  {
    id: "pi",
    label: "Pi",
    launchCmd: "pi",
    detectCmd: "pi",
    expectedProcess: "pi",
    iconId: "pi",
    faviconDomain: "pi.dev",
  },
  {
    id: "amp",
    label: "Amp",
    launchCmd: "amp",
    detectCmd: "amp",
    expectedProcess: "amp",
    faviconDomain: "ampcode.com",
  },
];

const byId = new Map<string, AgentCatalogEntry>(
  AGENT_CATALOG.map((entry) => [entry.id, entry])
);

export function getAgentCatalogEntry(
  id: AgentKind
): AgentCatalogEntry | undefined {
  return byId.get(id);
}

export function getKnownDetectCommands(): string[] {
  const out = new Set<string>();
  for (const entry of AGENT_CATALOG) {
    out.add(entry.detectCmd);
    for (const alias of entry.detectCmdAliases ?? []) {
      out.add(alias);
    }
  }
  return [...out];
}
