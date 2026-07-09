import type { AgentKind } from "@shared/contracts/agent.ts";
import type {
  AiGenerateTextRequest,
  AiGenerateTextResult,
  AiStatusResult,
} from "@shared/contracts/ai.ts";
import type {
  IDockviewPanelProps,
  PierDockviewGroupHandle,
} from "@shared/contracts/dockview.ts";
import type { MissionControlGridSize } from "@shared/contracts/mission-control.ts";
import type { PanelContext } from "@shared/contracts/panel.ts";
import type { JsonValue } from "@shared/contracts/plugin-settings.ts";
import type { TerminalSelectionTextResult } from "@shared/contracts/terminal.ts";
import type { LucideIcon } from "lucide-react";
import type { FunctionComponent, ReactNode } from "react";
import type { PluginConfigurationApi } from "./configuration.ts";
import type {
  RendererPluginEnvironmentsFacade,
  RendererPluginFilesFacade,
  RendererPluginGitFacade,
  RendererPluginWorktreesFacade,
} from "./renderer-facades.ts";

export type {
  RendererPluginEnvironmentsFacade,
  RendererPluginFilesFacade,
  RendererPluginGitFacade,
  RendererPluginWorktreesFacade,
} from "./renderer-facades.ts";

export type RendererPluginMessageValues = Record<string, number | string>;

export type RendererPluginActionCategoryKey =
  | "git"
  | "panel"
  | "run"
  | "settings"
  | "terminal"
  | "view"
  | "window"
  | "workspace"
  | "worktree"
  | "file";

export interface RendererPluginActionMetadata {
  categoryKey?: RendererPluginActionCategoryKey;
  excludeFromMru?: boolean;
  group?: string;
  iconComponent?: LucideIcon;
  sortOrder?: number;
  submenu?: () => string;
}

export interface ActionInvocation {
  metadata?: Record<string, unknown>;
  sourcePanelComponent?: string;
  sourcePanelContext?: PanelContext;
  sourcePanelGroupId?: string;
  sourcePanelId?: string;
  surface?: string;
}

export type RendererPluginActionInvocation = ActionInvocation;

export interface RendererPluginAction {
  category: string;
  disabledReason?: () => null | string | undefined;
  enabled?: () => boolean;
  handler: (
    invocation?: RendererPluginActionInvocation
  ) => Promise<void> | void;
  id: string;
  metadata?: RendererPluginActionMetadata;
  surfaces?: readonly (string & {})[];
  title: () => string;
}

export interface RendererPluginQuickPickItemBadge {
  readonly label: string;
  readonly variant?:
    | "default"
    | "destructive"
    | "ghost"
    | "outline"
    | "secondary";
}

export interface RendererPluginQuickPickItem {
  readonly aliases?: readonly string[];
  readonly badges?: readonly RendererPluginQuickPickItemBadge[];
  readonly checked?: boolean;
  readonly data?: unknown;
  readonly description?: string;
  readonly detail?: string;
  readonly disabled?: boolean;
  readonly icon?: LucideIcon;
  readonly id: string;
  readonly label: string;
  readonly searchTerms?: readonly string[];
  readonly variant?: "default" | "destructive";
}

export interface RendererPluginQuickPickSection {
  readonly heading: string;
  readonly id: string;
  readonly items: readonly RendererPluginQuickPickItem[];
}

export interface RendererPluginQuickPick {
  readonly items?: readonly RendererPluginQuickPickItem[];
  onAccept(item: RendererPluginQuickPickItem): Promise<void> | void;
  onChangeSelection?(item: RendererPluginQuickPickItem): void;
  onDismiss?(): void;
  readonly placeholder?: string;
  renderItem?(item: RendererPluginQuickPickItem): ReactNode;
  readonly sections?: readonly RendererPluginQuickPickSection[];
  readonly title: string;
}

export interface RendererTerminalStatusItemContext {
  context: PanelContext | undefined;
  cwd: string | null;
  panelId: string;
  title: string | null;
}

export interface RendererTerminalStatusItem {
  id: string;
  isVisible?: (context: RendererTerminalStatusItemContext) => boolean;
  order?: number;
  render: (context: RendererTerminalStatusItemContext) => ReactNode;
}

export interface MissionControlWidgetComponentProps {
  /** 实例 id。多实例物料用它区分数据作用域与持久化身份。 */
  instanceId: string;
  /**
   * 物料私有配置（随 panel params 持久化）。宿主视为黑盒 JSON——
   * 校验责任在物料边界，用自己的 zod schema 解析并对非法值降级。
   */
  params: Readonly<Record<string, JsonValue>>;
  /**
   * 手动刷新信号：卡片菜单"刷新"/面板"刷新全部"时递增。
   * 拉取型物料把它放进 effect 依赖以触发重拉；推送型物料可忽略。
   */
  refreshToken: number;
  /**
   * 卡片占位（格子数，非像素）。用于逻辑分支（如"h ≥ 4 才显示列表"）。
   * 内容级响应式布局请用 container query（CardContent 已开 @container），
   * 勿依赖本值换算像素——格宽固定但列数随面板宽度变化。
   */
  size: MissionControlGridSize;
  /** 写回物料配置（浅合并 patch 并持久化）。 */
  updateParams: (patch: Record<string, JsonValue>) => void;
  /** 所在指挥中心面板的 dockview 可见性。轮询闸门：不可见时必须停止轮询。 */
  visible: boolean;
}

/** 物料设置面板组件的 props（渲染进宿主 Sheet）。 */
export interface MissionControlWidgetSettingsProps {
  instanceId: string;
  params: Readonly<Record<string, JsonValue>>;
  updateParams: (patch: Record<string, JsonValue>) => void;
}

export interface RendererMissionControlWidgetRegistration {
  component: FunctionComponent<MissionControlWidgetComponentProps>;
  icon: LucideIcon;
  /** 必须在本插件 manifest.missionControlWidgets 中声明 */
  id: string;
  /**
   * 物料库预览卡（喂样例数据的静态渲染，宿主以 pointer-events-none 展示）。
   * 缺省回退"图标 + 骨架示意"。
   */
  previewComponent?: FunctionComponent;
  /** 设置面板。声明 configurable 的物料必须同步提供，否则菜单不显示"设置"。 */
  settingsComponent?: FunctionComponent<MissionControlWidgetSettingsProps>;
  /** 可选标题 thunk，locale 切换实时生效；省略则用 manifest 本地化解析结果 */
  title?: (() => string) | string;
}

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
  /**
   * true 表示打开前替换目标 group 内同 componentId 的未固定 preview。
   * 未传 targetGroupId 时只回退当前 active group；没有 active group 时跳过关闭。
   */
  dropUnpinnedInstances?: boolean;
  instanceId: string;
  params?: Record<string, unknown>;
  /**
   * 指定目标 dockview group。传入后,宿主只在该 group 内执行 preview 替换和
   * 已有 instanceId 复用。若 group 不存在,宿主不得关闭任何 preview,也不得
   * 更新或激活目标 group 外的已有 instance。
   */
  targetGroupId?: PluginPanelGroupId;
  title?: string;
}

export interface PluginPanelRegistration {
  component: FunctionComponent<IDockviewPanelProps>;
  /**
   * 可选 thunk:open 时计算 dockview addPanel 的 params,组件经 props.params 读。
   * 用于把已 i18n 化的字符串等运行时数据传给 panel 组件 —— 插件不能直接 import
   * renderer 的 i18n hook,这是把宿主 i18n 结果带入组件的标准通道。
   */
  getParams?: () => Record<string, unknown>;
  icon: LucideIcon;
  /**
   * Panel 标识。本字段同时充当 dockview 的 component 名与 panel 单例 id,
   * 三者必须一致(panels.open 据此查 component、addPanel 据此当 id)。
   */
  id: string;
  kind: "terminal" | "web";
  /** 可选 tab 标题。传 thunk 让 locale 切换时实时生效;省略则 fallback 到 id。 */
  title?: (() => string) | string;
}

/** loading 通知句柄:后续更新/收尾都作用在同一条 toast 上。 */
export interface RendererPluginLoadingNotification {
  dismiss(): void;
  info(message: string): void;
  success(message: string): void;
}

export interface RendererPluginNotificationOptions {
  /** toast 上的动作按钮(如移动后的「撤销」)。点击后 toast 自动关闭。 */
  action?: {
    label: string;
    onClick: () => void;
  };
  description?: string;
}

export type RendererPluginDialogIntent = "default" | "destructive";
export type RendererPluginDialogSize = "default" | "sm";

export interface RendererPluginAgentSelection {
  detectedIds: readonly AgentKind[];
  enabledIds: readonly AgentKind[];
  selectedId: AgentKind | null;
}

export interface RendererPluginTerminalContext {
  activePanelId(): string | null;
  readSelectionText(panelId?: string): Promise<TerminalSelectionTextResult>;
}

export interface RendererPluginContext {
  actions: {
    register(action: RendererPluginAction): () => void;
  };
  /**
   * Host-owned agent selection state. Plugins get a narrow snapshot so they can
   * offer agent choices without importing renderer stores.
   */
  agents: {
    selection(): Promise<RendererPluginAgentSelection>;
  };
  /**
   * AI 任务级能力(main 侧持有 provider 配置与密钥;插件需声明 ai:invoke)。
   * 结果用 status 区分,不抛业务异常 —— 未配置/失败时调用方自行降级。
   */
  ai: {
    generateText(request: AiGenerateTextRequest): Promise<AiGenerateTextResult>;
    status(): Promise<AiStatusResult>;
  };
  commandPalette: {
    openQuickPick(quickPick: RendererPluginQuickPick): void;
  };
  configuration: PluginConfigurationApi;
  /**
   * 弹出宿主级原生上下文菜单。插件在 DOM 右键处理里计算 CSS 坐标,宿主内部
   * 转成 BrowserWindow contentView 坐标 + 收集 surface 上注册的 actions +
   * popup native menu + 触发选中 action.handler(invocation)。
   * 传入 invocation.metadata 是 action.handler 侧的载荷通道(具体形状由
   * surface + action 双方约定,插件用 zod 或类型守卫解析)。
   */
  contextMenu: {
    popup(
      surface: string,
      coords: { x: number; y: number },
      invocation?: {
        metadata?: Record<string, unknown>;
        sourcePanelComponent?: string;
        sourcePanelContext?: PanelContext;
        sourcePanelGroupId?: string;
        sourcePanelId?: string;
      }
    ): Promise<void>;
  };
  /**
   * 宿主级模态弹窗。渲染、blocking overlay、终端输入路由与 keybinding scope
   * 均由宿主统一处理;全局单例,新弹窗会顶替未决的旧弹窗(旧的按取消 resolve)。
   * confirmLabel/cancelLabel 省略时用宿主 i18n 的默认文案(OK/Cancel)。
   */
  dialogs: {
    alert(options: {
      body?: string;
      confirmLabel?: string;
      intent?: RendererPluginDialogIntent;
      size?: RendererPluginDialogSize;
      title: string;
    }): Promise<void>;
    confirm(options: {
      body?: string;
      cancelLabel?: string;
      confirmLabel?: string;
      intent: RendererPluginDialogIntent;
      size: RendererPluginDialogSize;
      title: string;
    }): Promise<boolean>;
    /**
     * 三选弹窗(如 保存/放弃/取消)。confirm → "confirm",altLabel 按钮 →
     * "alt",取消/Esc → "cancel"。intent 作用于 alt 按钮(破坏性放弃)。
     */
    choice(options: {
      altLabel: string;
      body?: string;
      cancelLabel?: string;
      confirmLabel: string;
      intent: RendererPluginDialogIntent;
      size: RendererPluginDialogSize;
      title: string;
    }): Promise<"alt" | "cancel" | "confirm">;
    // 文本输入弹窗。resolve:submit → 返回 trim 后的字符串;cancel → null。
    // validate 在 submit 前跑一次,返回非空 = 校验失败(在弹窗内展示,不 resolve),
    // 返回 null/undefined 才放行。keybinding scope + terminal focus 与 host 统一处理。
    prompt(options: {
      body?: string;
      cancelLabel?: string;
      confirmLabel?: string;
      initialValue?: string;
      intent: RendererPluginDialogIntent;
      placeholder?: string;
      size: RendererPluginDialogSize;
      title: string;
      validate?: (value: string) => Promise<string | null> | string | null;
    }): Promise<string | null>;
  };
  /**
   * Local environment facade. Reads require `environment:read`; writes require
   * `environment:write`.
   */
  environments: RendererPluginEnvironmentsFacade;
  files: RendererPluginFilesFacade;
  /**
   * Git 主体能力(对应 main 进程 GitService;插件按 manifest 声明的 capability 调用)。
   * 这里仅做 preload facade 的窄透传,git 业务交互仍由插件自己实现。
   */
  git: RendererPluginGitFacade;
  groupContent: {
    claim(claim: PluginGroupContentClaim): boolean;
    release(input: { groupId: string; id: string; ownerId: symbol }): void;
  };
  i18n: {
    commandDescription(commandId: string): string | undefined;
    commandTitle(commandId: string, fallback?: string): string;
    language(): string;
    t(
      key: string,
      values?: RendererPluginMessageValues,
      fallback?: string
    ): string;
  };
  missionControlWidgets: {
    register(
      registration: RendererMissionControlWidgetRegistration
    ): () => void;
  };
  /**
   * 通知能力。error/info/success/loading 是应用内 toast(由宿主统一渲染与
   * 排队,插件不感知具体 toast 库);system 是 OS 级系统通知(走 main 进程
   * Electron Notification,窗口失焦/最小化时也可见)。需要用户决策的场景用
   * dialogs;这里只做结果播报。
   */
  notifications: {
    error(message: string, options?: RendererPluginNotificationOptions): void;
    info(message: string, options?: RendererPluginNotificationOptions): void;
    loading(message: string): RendererPluginLoadingNotification;
    success(message: string, options?: RendererPluginNotificationOptions): void;
    system(options: {
      body?: string;
      title: string;
    }): Promise<{ shown: boolean }>;
  };
  /**
   * 宿主级模态 overlay。渲染、blocking overlay、终端输入路由与 keybinding
   * scope 均由宿主统一处理;全局单例,新 overlay 会顶替当前未决的旧 overlay。
   * 不设 manifest 权限;插件 deactivate 时宿主自动关闭其残留 overlay。
   */
  overlays: {
    close(id: string): void;
    open(overlay: {
      id: string;
      render: (controls: { close: () => void }) => ReactNode;
    }): void;
  };
  panels: {
    /**
     * 当前活动 panel 若属于本插件贡献的组件,返回其 dockview instance id。
     * 用于 keybinding 分发时定位到具体 panel 实例(action.handler 收到的
     * invocation 里没有 panelId,得插件主动查)。不属于本插件的 panel
     * (含 null active) 返回 null,不越权。
     */
    getActiveContext(): PanelContext | null;
    getActiveInstanceId(componentId: string): string | null;
    listInstances(componentId: string): readonly PluginPanelInstanceSnapshot[];
    /**
     * 单例打开指定 panel。panelId 必须在本插件 manifest 的 panels[] 中声明 ——
     * 不支持打开其它插件贡献的 panel(权限/所有权对称约束)。
     */
    open(panelId: string, options?: { context?: PanelContext }): void;
    openInstance(options: PluginPanelInstanceOptions): void;
    register(registration: PluginPanelRegistration): () => void;
    /**
     * 注册关闭前守卫。仅可为本插件声明的 componentId 注册；返回 false 可否决关闭。
     */
    registerCloseGuard(
      componentId: string,
      guard: (input: {
        closingPanelIds?: readonly string[];
        componentId: string;
        panelId: string;
        params?: unknown;
      }) => boolean | Promise<boolean>
    ): () => void;
  };
  settings: {
    openSection(section: "environment"): void;
  };
  terminal: RendererPluginTerminalContext;
  terminalStatusItems: {
    register(item: RendererTerminalStatusItem): () => void;
  };
  worktrees: RendererPluginWorktreesFacade;
}

export interface RendererPluginModule {
  activate(context: RendererPluginContext): () => void;
  /**
   * 设置页等宿主 UI 用的插件图标。放在 module 而非 manifest:manifest 是可序列化
   * 数据(跨 IPC),而 builtin module 被宿主静态 import,禁用状态下也取得到。
   */
  icon?: LucideIcon;
  id: string;
}
