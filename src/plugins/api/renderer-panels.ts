import type {
  IDockviewPanelProps,
  PierDockviewGroupHandle,
} from "@shared/contracts/dockview.ts";
import type { PanelContext, PanelTabChrome } from "@shared/contracts/panel.ts";
import type { FunctionComponent, ReactNode } from "react";

export interface PluginGroupContentClaim {
  group: PierDockviewGroupHandle;
  id: string;
  ownerId: symbol;
  render: () => ReactNode;
  visible: (group: PierDockviewGroupHandle) => boolean;
}

export type PluginPanelGroupId = string;

export interface PluginPanelInstanceSnapshot {
  readonly componentId: string;
  readonly groupId: PluginPanelGroupId | null;
  readonly id: string;
  readonly params?: Readonly<Record<string, unknown>>;
  readonly title: string;
}

export interface PluginPanelInstanceOptions {
  componentId: string;
  context?: PanelContext;
  /** 替换目标 group 中同 componentId 的未固定 preview。 */
  dropUnpinnedInstances?: boolean;
  instanceId: string;
  params?: Record<string, unknown>;
  /** 显式 group 不存在时，宿主不得产生任何布局副作用。 */
  targetGroupId?: PluginPanelGroupId;
  title?: string;
}

export type PluginPanelInstanceOpenResult =
  | { readonly kind: "opened" }
  | { readonly kind: "targetGroupMissing" };

export interface PluginPanelRegistration {
  component: FunctionComponent<IDockviewPanelProps>;
  /** open 时计算 dockview params。 */
  getParams?: () => Record<string, unknown>;
  icon: import("lucide-react").LucideIcon;
  /** 同时作为 dockview component 名与 panel 单例 id。 */
  id: string;
  kind: "terminal" | "web";
  resolveTab?: (input: {
    params: Readonly<Record<string, unknown>>;
    title: string;
  }) => PanelTabChrome | undefined;
  /**
   * 重资源 panel 不使用 React Activity 保活。
   * 宿主始终挂载 shell；panel 自行按 isVisible 卸载重内容，
   * 并在真正关闭（onDidRemovePanel）时回收会话等缓存。
   */
  resourcePolicy?: "unmountWhenHidden";
  title?: (() => string) | string;
}
