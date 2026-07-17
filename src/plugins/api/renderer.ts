import type { AgentSelectionResult } from "@shared/contracts/agent-usage.ts";
import type {
  AiGenerateTextRequest,
  AiGenerateTextResult,
  AiStatusResult,
} from "@shared/contracts/ai.ts";
import type { ExternalNavigationResult } from "@shared/contracts/external-navigation.ts";
import type {
  FilePreviewTicketIssueResult,
  FilePreviewTicketLocator,
} from "@shared/contracts/file-preview-ticket.ts";
import type { PanelContext } from "@shared/contracts/panel.ts";
import type {
  TerminalOpenUrlEvent,
  TerminalSelectionTextResult,
} from "@shared/contracts/terminal.ts";
import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import type { PluginConfigurationApi } from "./configuration.ts";
import type {
  RendererPluginAppearance,
  RendererPluginMermaidResult,
} from "./renderer-appearance.ts";
import type {
  RendererPluginEnvironmentsFacade,
  RendererPluginFilesFacade,
  RendererPluginGitFacade,
  RendererPluginWorktreesFacade,
} from "./renderer-facades.ts";
import type {
  PluginGroupContentClaim,
  PluginPanelInstanceOpenResult,
  PluginPanelInstanceOptions,
  PluginPanelInstanceSnapshot,
  PluginPanelRegistration,
} from "./renderer-panels.ts";
import type { RendererWorkbenchWidgetRegistration } from "./workbench.ts";

export type {
  RendererPluginAppearance,
  RendererPluginMermaidResult,
} from "./renderer-appearance.ts";
export type {
  RendererPluginEnvironmentsFacade,
  RendererPluginFilesFacade,
  RendererPluginGitFacade,
  RendererPluginWorktreesFacade,
} from "./renderer-facades.ts";
export type {
  PluginGroupContentClaim,
  PluginPanelGroupId,
  PluginPanelInstanceOpenResult,
  PluginPanelInstanceOptions,
  PluginPanelInstanceSnapshot,
  PluginPanelRegistration,
} from "./renderer-panels.ts";
export type {
  RendererWorkbenchWidgetAction,
  RendererWorkbenchWidgetRegistration,
  WorkbenchWidgetActionContext,
  WorkbenchWidgetComponentProps,
  WorkbenchWidgetSettingsProps,
} from "./workbench.ts";

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
  /** 异步搜索的错误提示；渲染在候选列表上方。 */
  readonly errorText?: string;
  /** 根据当前输入生成一个置顶候选；必须同步且无副作用。 */
  getQueryItem?(query: string): RendererPluginQuickPickItem | null;
  readonly items?: readonly RendererPluginQuickPickItem[];
  /** true = 保留当前 items 但禁用交互, 提示后端正在拉数据。 */
  readonly loading?: boolean;
  onAccept(item: RendererPluginQuickPickItem): Promise<void> | void;
  onChangeSelection?(item: RendererPluginQuickPickItem): void;
  onDismiss?(): void;
  /**
   * 输入变化 (及打开时的初始值) 触发, 同一 session 内后续调用会 abort 上一次的
   * signal, 宿主关闭面板时也 abort。插件在回调里做异步搜索然后通过
   * commandPalette.updateQuickPick 合并 items/loading/errorText。
   */
  onQueryChange?(query: string, signal: AbortSignal): Promise<void> | void;
  readonly placeholder?: string;
  renderItem?(item: RendererPluginQuickPickItem): ReactNode;
  readonly sections?: readonly RendererPluginQuickPickSection[];
  readonly title: string;
}

export interface RendererTerminalStatusItemContext {
  context: PanelContext | undefined;
  cwd: string | null;
  /** 交互发生时读取面板当前所属分组，避免使用渲染时快照打开到旧分组。 */
  getGroupId: () => string | null;
  panelId: string;
  title: string | null;
}

export interface RendererTerminalStatusItem {
  id: string;
  isVisible?: (context: RendererTerminalStatusItemContext) => boolean;
  order?: number;
  render: (context: RendererTerminalStatusItemContext) => ReactNode;
}

/** loading 通知句柄:后续更新/收尾都作用在同一条 toast 上。 */
export interface RendererPluginLoadingNotification {
  dismiss(): void;
  info(message: string): void;
  success(message: string): void;
  /** 更新同一条 toast 文案，并保持 loading 状态。 */
  update(message: string): void;
}

export interface RendererPluginNotificationOptions {
  /** toast 上的动作按钮(如移动后的「撤销」)。点击后 toast 自动关闭。 */
  action?: {
    label: string;
    onClick: () => void;
  };
}

export type RendererPluginDialogIntent = "default" | "destructive";
export type RendererPluginDialogSize = "default" | "sm";

export type RendererPluginAgentSelection = AgentSelectionResult;

export interface RendererPluginTerminalContext {
  activePanelId(): string | null;
  getPanelContext(panelId: string): PanelContext | null;
  onOpenUrl(cb: (event: TerminalOpenUrlEvent) => void): () => void;
  readSelectionText(panelId?: string): Promise<TerminalSelectionTextResult>;
}

export type RendererPluginSuspendReason =
  | "app-quit"
  | "plugin-disable"
  | "plugin-reload"
  | "runtime-dispose"
  | "runtime-refresh"
  | "window-close";

export interface RendererPluginSuspendContext {
  reason: RendererPluginSuspendReason;
  signal: AbortSignal;
  transitionId: string;
}

export interface RendererPluginSuspendParticipant {
  abort?(
    reason: RendererPluginSuspendReason,
    context: { signal: AbortSignal; transitionId: string }
  ): Promise<void> | void;
  commit?(
    reason: RendererPluginSuspendReason,
    context: { signal: AbortSignal; transitionId: string }
  ): Promise<void> | void;
  prepare(context: RendererPluginSuspendContext): Promise<void> | void;
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
  ai: {
    generateText(request: AiGenerateTextRequest): Promise<AiGenerateTextResult>;
    status(): Promise<AiStatusResult>;
  };
  /**
   * AI 任务级能力(main 侧持有 provider 配置与密钥;插件需声明 ai:invoke)。
   * 结果用 status 区分,不抛业务异常 —— 未配置/失败时调用方自行降级。
   */
  appearance: {
    current(): RendererPluginAppearance;
    onDidChange(
      listener: (appearance: RendererPluginAppearance) => void
    ): () => void;
  };
  charts: {
    renderMermaid(source: string): Promise<RendererPluginMermaidResult>;
  };
  commandPalette: {
    openQuickPick(quickPick: RendererPluginQuickPick): void;
    /**
     * 合并式补丁当前 quickPick (items/loading/errorText 等)。用于 onQueryChange
     * 拉到数据后回填, 不重置 query/selection/focus, 也不 push 回退栈。
     */
    updateQuickPick(patch: Partial<RendererPluginQuickPick>): void;
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
  externalNavigation: {
    open(url: string): Promise<ExternalNavigationResult>;
  };
  filePreviews: {
    issue(
      locator: FilePreviewTicketLocator,
      previousTicket?: string
    ): Promise<FilePreviewTicketIssueResult>;
    release(ticket: string): Promise<boolean>;
  };
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
  lifecycle: {
    beforeSuspend(participant: RendererPluginSuspendParticipant): () => void;
  };
  /**
   * 通知能力。error/info/success/loading 是应用内短 toast(由宿主统一渲染与
   * 排队,插件不感知具体 toast 库);可带可选 action(如撤销)。长说明/错误详情
   * 走 dialogs.alert。system 是 OS 级系统通知(走 main 进程 Electron
   * Notification,窗口失焦/最小化时也可见)。需要用户决策的场景用 dialogs。
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
      /** Bind `open` to the controlled modal primitive; `close` settles host state immediately. */
      render: (controls: { close: () => void; open: boolean }) => ReactNode;
    }): void;
  };
  panels: {
    /**
     * 当前活动 panel 若属于本插件贡献的组件,返回其 dockview instance id。
     * 用于 keybinding 分发；非本插件 panel 返回 null。
     */
    getActiveContext(): PanelContext | null;
    getActiveInstanceId(componentId: string): string | null;
    listInstances(componentId: string): readonly PluginPanelInstanceSnapshot[];
    updateInstanceParams(
      componentId: string,
      instanceId: string,
      patch: Record<string, unknown>
    ): boolean;
    /** 等待当前工作区 panel 布局耐久写入；用于跨身份迁移的提交屏障。 */
    flushLayout(): Promise<void>;
    /**
     * 单例打开指定 panel。panelId 必须在本插件 manifest 的 panels[] 中声明 ——
     * 不支持打开其它插件贡献的 panel(权限/所有权对称约束)。
     */
    open(panelId: string, options?: { context?: PanelContext }): void;
    openInstance(
      options: PluginPanelInstanceOptions
    ): PluginPanelInstanceOpenResult;
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
  workbenchWidgets: {
    register(registration: RendererWorkbenchWidgetRegistration): () => void;
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
