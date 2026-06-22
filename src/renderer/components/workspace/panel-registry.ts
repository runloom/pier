import type { IDockviewPanelProps } from "dockview-react";
import type { FunctionComponent } from "react";
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
  welcome: WelcomePanel,
};
