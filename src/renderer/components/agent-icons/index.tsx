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

// 本地打包的 favicon（下载自各 agent 域名，文件名即 agentId）。运行时不再依赖
// Google favicon service——离线可用，且绕开 img-src CSP（外部图源会被拦成空白）。
// catalog 的 faviconDomain 保留为「下载来源」元数据；要更新图标重新下到此目录即可。
const LOCAL_FAVICONS = import.meta.glob("./favicons/*.png", {
  eager: true,
  query: "?url",
  import: "default",
}) as Record<string, string>;

function localFaviconUrl(id: AgentKind): string | undefined {
  return LOCAL_FAVICONS[`./favicons/${id}.png`];
}

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
  const favicon = localFaviconUrl(agentId);
  if (favicon) {
    return <AgentImg size={size} src={favicon} />;
  }
  return (
    <AgentLetterIcon
      letter={(entry?.label ?? agentId).charAt(0).toUpperCase()}
      size={size}
    />
  );
}
