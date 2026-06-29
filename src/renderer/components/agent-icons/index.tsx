import { getAgentCatalogEntry } from "@shared/agent-catalog.ts";
import type { AgentKind } from "@shared/contracts/agent.ts";
import type { FC } from "react";
import {
  AgentLetterIcon,
  AiderIcon,
  ClaudeIcon,
  CopilotIcon,
  DroidIcon,
  GeminiIcon,
  KiloIcon,
  OmpIcon,
  OpenAIIcon,
  PiIcon,
} from "./glyphs.tsx";
import openClaudeLogoUrl from "./openclaude-logo.png?url";

const ICON_BY_ID: Record<string, FC<{ size?: number }>> = {
  claude: ClaudeIcon,
  codex: OpenAIIcon,
  aider: AiderIcon,
  copilot: CopilotIcon,
  droid: DroidIcon,
  pi: PiIcon,
  gemini: GeminiIcon,
  omp: OmpIcon,
  kilo: KiloIcon,
};

function AgentImg({ src, size }: { src: string; size: number }) {
  return (
    <img
      alt=""
      aria-hidden
      height={size}
      src={src}
      style={{ borderRadius: 2 }}
      width={size}
    />
  );
}

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
  if (entry?.iconUrl) {
    const src =
      entry.iconUrl === "openclaude" ? openClaudeLogoUrl : entry.iconUrl;
    return <AgentImg size={size} src={src} />;
  }
  if (entry?.faviconDomain) {
    return (
      <AgentImg
        size={size}
        src={`https://www.google.com/s2/favicons?domain=${entry.faviconDomain}&sz=64`}
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
