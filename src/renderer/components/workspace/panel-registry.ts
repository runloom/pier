import type { IDockviewPanelProps } from "dockview-react";
import type { LucideIcon } from "lucide-react";
import type { FunctionComponent } from "react";
import { gitChangesPanelKit } from "@/panel-kits/git-changes/git-changes-panel.tsx";
import { terminalPanelKit } from "@/panel-kits/terminal/terminal-panel.tsx";
import { welcomePanelKit } from "./welcome-panel.tsx";

type PanelKind = "terminal" | "web";

interface PanelKitMetadata {
  component: FunctionComponent<IDockviewPanelProps>;
  icon: LucideIcon;
  kind: PanelKind;
}

/**
 * Panel kit 元数据聚合表 — dockview addPanel 的 component 名映射到 kit 能力。
 *
 * 新增 panel 类型时:
 * 1. 在 panel-kits/<name>/ 下实现并导出 kit 元数据
 * 2. 在此登记一行 component 名到 kit 元数据的映射
 * 3. 业务侧调 useWorkspaceStore().addPanel({ component: <name>, ... })
 */
export const panelKits = {
  gitChanges: gitChangesPanelKit,
  terminal: terminalPanelKit,
  welcome: welcomePanelKit,
} satisfies Record<string, PanelKitMetadata>;

const panelKitByComponent: Readonly<Record<string, PanelKitMetadata>> =
  panelKits;

export const panelComponents: Record<
  string,
  FunctionComponent<IDockviewPanelProps>
> = {
  gitChanges: panelKits.gitChanges.component,
  terminal: panelKits.terminal.component,
  welcome: panelKits.welcome.component,
};

/**
 * Panel kit 类型元数据 — keyboard 路由用。
 * - 'terminal': panel 内是 Ghostty native NSView, 需要 firstResponder = terminalView
 * - 'web': panel 内全是 web DOM, firstResponder = WKWebView
 *
 * 新加 panel kit 时在这里登记一行。未知 panel default 'web' 安全
 * (不会让 terminal 抢 firstResponder)。
 */
export const panelKinds = {
  gitChanges: panelKits.gitChanges.kind,
  terminal: panelKits.terminal.kind,
  welcome: panelKits.welcome.kind,
} as const;

export function panelKindOf(component: string): "terminal" | "web" {
  return panelKitByComponent[component]?.kind ?? "web";
}

export function panelIconOf(component: string): LucideIcon | null {
  return panelKitByComponent[component]?.icon ?? null;
}
