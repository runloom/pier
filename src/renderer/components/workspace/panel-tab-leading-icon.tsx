import { fileNameFromTabIconId, PierFileIcon } from "@pier/ui/file-icon.tsx";
import { AgentIcon } from "@plugins/api/components/agent-icons/index.tsx";
import { agentKindFromTabIconId } from "@shared/contracts/agent-session.ts";
import type { PanelTabChrome } from "@shared/contracts/panel.ts";
import type { ReactNode } from "react";
import { resolvePanelTabIcon } from "./panel-tab-icon-registry.ts";

/**
 * Tab 与 overflow 下拉共用的 leading 图标，保证配色与数据路径一致
 *（Agent / 文件 / 语义 Lucide）。
 */
export function PanelTabLeadingIcon({
  component,
  size = 14,
  tab,
}: {
  component: string | undefined;
  size?: number;
  tab: PanelTabChrome | undefined;
}): ReactNode {
  const { Icon, iconId } = resolvePanelTabIcon(tab, component ?? "");
  const agentKind = agentKindFromTabIconId(tab?.icon?.id);
  const fileName = fileNameFromTabIconId(tab?.icon?.id);

  if (agentKind) {
    return (
      <span
        aria-hidden="true"
        className="flex shrink-0 items-center"
        data-panel-tab-icon={tab?.icon?.id}
      >
        <AgentIcon agentId={agentKind} size={size} />
      </span>
    );
  }

  if (fileName) {
    return (
      <PierFileIcon
        aria-hidden="true"
        className="pier-panel-tab-icon shrink-0"
        data-panel-tab-icon={tab?.icon?.id}
        fileName={fileName}
        size={size}
      />
    );
  }

  if (Icon) {
    return (
      <Icon
        aria-hidden="true"
        className="pier-panel-tab-icon shrink-0"
        data-panel-tab-icon={iconId}
        size={size}
      />
    );
  }

  return null;
}
