import type { PanelTabChrome } from "@shared/contracts/panel.ts";
import { ListChecks, type LucideIcon } from "lucide-react";
import { panelIconOf } from "./panel-registry.ts";

const builtinPanelTabIcons: Readonly<Record<string, LucideIcon>> = {
  "pier.task": ListChecks,
};

export function resolvePanelTabIcon(
  tab: PanelTabChrome | undefined,
  component: string
): { Icon: LucideIcon | null; iconId: string | undefined } {
  const tabIcon =
    tab?.icon?.id && tab.icon.id in builtinPanelTabIcons
      ? builtinPanelTabIcons[tab.icon.id]
      : null;
  if (tabIcon) {
    return { Icon: tabIcon, iconId: tab?.icon?.id };
  }
  return { Icon: panelIconOf(component), iconId: component };
}
