import { getAgentCatalogEntry } from "@shared/agent-catalog.ts";
import type { AgentKind } from "@shared/contracts/agent.ts";
import { Bot } from "lucide-react";
import type { FC } from "react";
import {
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

// 本地打包的 agent 图标（favicons/<id>.png）。多数下载自各域名（见
// scripts/download-agent-favicons.sh），openclaude.png 手动放入。
// 运行时用本地资产——离线 + 绕开 img-src CSP（外部图源会被拦成空白）。
// catalog 的 faviconDomain 仅作下载脚本的数据源，运行时不读。
const LOCAL_ICONS = import.meta.glob("./favicons/*.png", {
  eager: true,
  query: "?url",
  import: "default",
}) as Record<string, string>;

function localIconUrl(id: AgentKind): string | undefined {
  return LOCAL_ICONS[`./favicons/${id}.png`];
}

export function AgentIcon({
  agentId,
  size = 14,
}: {
  agentId: AgentKind | null | undefined;
  size?: number;
}) {
  if (agentId) {
    const entry = getAgentCatalogEntry(agentId);
    const Inline = entry?.iconId ? ICON_BY_ID[entry.iconId] : undefined;
    if (Inline) {
      return <Inline size={size} />;
    }
    const localIcon = localIconUrl(agentId);
    if (localIcon) {
      return (
        <img
          alt=""
          aria-hidden
          height={size}
          src={localIcon}
          style={{ borderRadius: 2 }}
          width={size}
        />
      );
    }
  }
  // 兜底：agent 未知（null，第二轮 panel 识别用）或暂无本地图标 →
  // lucide Bot（与 agents nav 图标一致）。
  return <Bot aria-hidden size={size} />;
}
