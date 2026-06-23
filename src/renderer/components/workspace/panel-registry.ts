import type { IDockviewPanelProps } from "dockview-react";
import type { FunctionComponent } from "react";
import { TerminalPanel } from "@/panel-kits/terminal/terminal-panel.tsx";
import { WelcomePanel } from "./welcome-panel.tsx";

/**
 * Panel 组件注册表 — dockview addPanel 的 component 名映射到 React 组件。
 *
 * 新增 panel 类型时:
 * 1. 在 panel-kits/<name>/ 下实现组件 (接收 IDockviewPanelProps)
 * 2. 在此注册: { <name>: <Component> }
 * 3. 业务侧调 useWorkspaceStore().addPanel({ component: <name>, ... })
 */
export const panelComponents: Record<
  string,
  FunctionComponent<IDockviewPanelProps>
> = {
  terminal: TerminalPanel,
  welcome: WelcomePanel,
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
  terminal: "terminal",
  welcome: "web",
} as const;

export function panelKindOf(component: string): "terminal" | "web" {
  return (panelKinds as Record<string, "terminal" | "web">)[component] ?? "web";
}
