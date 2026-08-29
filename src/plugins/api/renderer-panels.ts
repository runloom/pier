import type { PierCommandPlacement } from "@shared/contracts/commands.ts";
import type {
  IDockviewPanelProps,
  PierDockviewGroupHandle,
} from "@shared/contracts/dockview.ts";
import type { PanelContext, PanelTabChrome } from "@shared/contracts/panel.ts";
import type { FunctionComponent, ReactNode } from "react";
import type { PanelTransferRegistration } from "./panel-transfer-registration.ts";

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

/** Cross-window instance from `panels.listInstancesGlobal`. */
export interface PluginPanelGlobalInstanceSnapshot
  extends PluginPanelInstanceSnapshot {
  readonly windowId: string;
}

export type PluginPanelFocusInstanceResult =
  | { readonly kind: "focused" }
  | { readonly kind: "not_found" }
  | { readonly kind: "error"; readonly message: string };

export interface PluginPanelInstanceOptions {
  componentId: string;
  context?: PanelContext;
  /** 替换目标 group 中同 componentId 的未固定 preview。 */
  dropUnpinnedInstances?: boolean;
  instanceId: string;
  params?: Record<string, unknown>;
  placement?: PierCommandPlacement;
  referencePanelId?: string;
  /** 显式 group 不存在时，宿主不得产生任何布局副作用。 */
  targetGroupId?: PluginPanelGroupId;
  title?: string;
}

export type PluginPanelInstanceOpenResult =
  | { readonly kind: "opened" }
  | { readonly kind: "targetGroupMissing" };

/** Plugin-facing panels host surface (local + cross-window). */
export interface RendererPluginPanelsFacade {
  /**
   * Close one of this plugin's instances. Does not close the window when it
   * is the last panel — a welcome tab is added first.
   */
  closeInstance(options: { componentId: string; instanceId: string }): boolean;
  flushLayout(): Promise<void>;
  /** Focus a declared instance in any window (brings that window forward). */
  focusInstance(options: {
    componentId: string;
    instanceId: string;
    windowId: string;
  }): Promise<PluginPanelFocusInstanceResult>;
  /** Active panel context when it belongs to this plugin; otherwise null. */
  getActiveContext(): PanelContext | null;
  getActiveInstanceId(componentId: string): string | null;
  listInstances(componentId: string): readonly PluginPanelInstanceSnapshot[];
  /** Cross-window list of declared component instances (includes current window). */
  listInstancesGlobal(
    componentId: string
  ): Promise<readonly PluginPanelGlobalInstanceSnapshot[]>;
  /** Singleton open; panelId must be declared by this plugin. */
  open(panelId: string, options?: { context?: PanelContext }): void;
  openInstance(
    options: PluginPanelInstanceOptions
  ): PluginPanelInstanceOpenResult;
  register(registration: PluginPanelRegistration): () => void;
  registerCloseGuard(
    componentId: string,
    guard: (input: {
      closingPanelIds?: readonly string[];
      componentId: string;
      panelId: string;
      params?: unknown;
    }) => boolean | Promise<boolean>
  ): () => void;
  updateInstanceParams(
    componentId: string,
    instanceId: string,
    patch: Record<string, unknown>
  ): boolean;
}

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
  /**
   * 跨窗口拖拽注册（可选）。未声明 → 同窗可拖、跨窗 unsupported。
   * 外部插件不得声明 `kind: "terminal"`；宿主会拒绝。
   */
  transfer?: PanelTransferRegistration;
}
