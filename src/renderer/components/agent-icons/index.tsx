import { getAgentCatalogEntry } from "@shared/agent-catalog.ts";
import type { AgentKind } from "@shared/contracts/agent.ts";
import type { FC } from "react";
import {
  AgentLetterIcon,
  AiderIcon,
  ClaudeIcon,
  CopilotIcon,
  DroidIcon,
  OpenAIIcon,
  PiIcon,
} from "./glyphs.tsx";

const ICON_BY_ID: Record<string, FC<{ size?: number }>> = {
  claude: ClaudeIcon,
  codex: OpenAIIcon,
  aider: AiderIcon,
  copilot: CopilotIcon,
  droid: DroidIcon,
  pi: PiIcon,
};

export function AgentIcon({
  agentId,
  size = 14,
}: {
  agentId: AgentKind | null | undefined;
  size?: number;
}) {
  if (!agentId) {
    return <AgentLetterIcon letter="?" size={size} />;
  }
  const entry = getAgentCatalogEntry(agentId);
  const Inline = entry?.iconId ? ICON_BY_ID[entry.iconId] : undefined;
  if (Inline) {
    return <Inline size={size} />;
  }
  if (entry?.faviconDomain) {
    return (
      <img
        alt=""
        aria-hidden
        height={size}
        src={`https://www.google.com/s2/favicons?domain=${entry.faviconDomain}&sz=64`}
        style={{ borderRadius: 2 }}
        width={size}
      />
    );
  }
  return (
    <AgentLetterIcon
      letter={(entry?.label ?? agentId).charAt(0).toUpperCase()}
      size={size}
    />
  );
}
