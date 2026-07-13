import type { IDockviewPanelProps } from "dockview-react";
import type { LucideIcon } from "lucide-react";
import type { FunctionComponent } from "react";
import { getPluginPanelRegistrations } from "@/lib/plugins/plugin-panel-registry.ts";
import { missionControlPanelKit } from "@/panel-kits/mission-control/mission-control-panel.tsx";
import { terminalPanelKit } from "@/panel-kits/terminal/terminal-panel.tsx";
import {
  withPanelResourceBoundary,
  withPluginPanelHostBoundary,
} from "./panel-resource-boundary.tsx";
import { welcomePanelKit } from "./welcome-panel.tsx";

type PanelKind = "terminal" | "web";

interface PanelKitMetadata {
  component: FunctionComponent<IDockviewPanelProps>;
  icon: LucideIcon;
  kind: PanelKind;
}

/**
 * Core（主系统）panel kit 静态表 — terminal native bridge、welcome fallback
 * 等系统预留能力。业务插件 panel 通过 plugin-panel-registry 动态叠加，
 * 见 getPanelComponents()。新增主系统 panel 时在此登记一行。
 */
export const panelKits = {
  "mission-control": missionControlPanelKit,
  terminal: terminalPanelKit,
  welcome: welcomePanelKit,
} satisfies Record<string, PanelKitMetadata>;

/**
 * 兼容映射：2026-07 大盘改名指挥中心（"dashboard" → "mission-control"）之前
 * 持久化的 layout 仍以旧 component id 反序列化，指向同一 kit。只用于恢复，
 * 新建面板一律走 "mission-control"。
 */
const legacyPanelKitAliases: Readonly<Record<string, PanelKitMetadata>> = {
  dashboard: missionControlPanelKit,
};

const corePanelKitByComponent: Readonly<Record<string, PanelKitMetadata>> = {
  ...legacyPanelKitAliases,
  ...panelKits,
};

/**
 * dockview component 名 → React 组件。合并 core 静态 panel 与插件动态 panel。
 * 在 workspace-host render 时调用（此时 bootstrap 已注册插件 panel）。
 */
export function getPanelComponents(): Record<
  string,
  FunctionComponent<IDockviewPanelProps>
> {
  const components: Record<string, FunctionComponent<IDockviewPanelProps>> = {};
  for (const [id, kit] of Object.entries(corePanelKitByComponent)) {
    components[id] =
      kit.kind === "terminal"
        ? kit.component
        : withPanelResourceBoundary(kit.component);
  }
  for (const [id, registration] of getPluginPanelRegistrations()) {
    if (!(id in components)) {
      components[id] = withPluginPanelHostBoundary(registration);
    }
  }
  return components;
}

/**
 * Panel kit 类型（keyboard 路由用）。core 优先，插件 panel 次之，未知 default 'web'。
 * - 'terminal': panel 内是 Ghostty native NSView, 需要 firstResponder = terminalView
 * - 'web': panel 内全是 web DOM, firstResponder = WKWebView
 */
export function panelKindOf(component: string): "terminal" | "web" {
  const core = corePanelKitByComponent[component];
  if (core) {
    return core.kind;
  }
  return getPluginPanelRegistrations().get(component)?.kind ?? "web";
}

export function panelIconOf(component: string): LucideIcon | null {
  const core = corePanelKitByComponent[component];
  if (core) {
    return core.icon;
  }
  return getPluginPanelRegistrations().get(component)?.icon ?? null;
}
