import type { AgentSelectionResult } from "@shared/contracts/agent/usage.ts";
import type {
  AiGenerateTextRequest,
  AiGenerateTextResult,
  AiStatusResult,
} from "@shared/contracts/ai.ts";
import type { ExternalNavigationResult } from "@shared/contracts/external-navigation.ts";
import type { HtmlPreviewTicketIssueResult } from "@shared/contracts/file/html-preview-ticket.ts";
import type {
  FilePreviewTicketIssueResult,
  FilePreviewTicketLocator,
} from "@shared/contracts/file/preview-ticket.ts";
import type { PanelContext } from "@shared/contracts/panel.ts";
import type { TerminalLaunchOptions } from "@shared/contracts/terminal/launch.ts";
import type {
  TerminalOpenUrlEvent,
  TerminalSelectionTextResult,
} from "@shared/contracts/terminal.ts";
import type { LucideIcon } from "lucide-react";
import type { ComponentType, ReactNode } from "react";
import type { PluginConfigurationApi } from "./configuration.ts";
import type {
  RendererPluginAppearance,
  RendererPluginMermaidResult,
} from "./renderer-appearance.ts";
import type { RendererPluginDialogsFacade } from "./renderer-dialogs.ts";
import type {
  RendererPluginCommentsFacade,
  RendererPluginEnvironmentsFacade,
  RendererPluginFilesFacade,
  RendererPluginGitFacade,
  RendererPluginProjectMemoryFacade,
  RendererPluginWorktreesFacade,
} from "./renderer-facades.ts";
import type {
  PluginGroupContentClaim,
  RendererPluginPanelsFacade,
} from "./renderer-panels.ts";

export interface RendererProjectSettingsRegistration {
  id: string;
  render: (props: {
    isPierHome: boolean;
    projectRootPath: string;
  }) => ReactNode;
  title: () => string;
  visible?: (props: { isPierHome: boolean }) => boolean;
}

export type { PanelTransferRegistration } from "./panel-transfer-registration.ts";
export type {
  RendererPluginAppearance,
  RendererPluginCodeThemeRegistration,
  RendererPluginMermaidResult,
} from "./renderer-appearance.ts";
export type {
  RendererPluginContentDialogHandle,
  RendererPluginContentDialogOpenRequest,
  RendererPluginContentDialogRenderProps,
  RendererPluginContentDialogSize,
  RendererPluginDialogIntent,
  RendererPluginDialogsFacade,
} from "./renderer-dialogs.ts";
export type {
  OpenProjectDirectoryResult,
  RendererPluginCommentsFacade,
  RendererPluginEnvironmentsFacade,
  RendererPluginFilesFacade,
  RendererPluginGitFacade,
  RendererPluginProjectMemoryFacade,
  RendererPluginWorktreesFacade,
} from "./renderer-facades.ts";
export type {
  PluginGroupContentClaim,
  PluginPanelFocusInstanceResult,
  PluginPanelGlobalInstanceSnapshot,
  PluginPanelGroupId,
  PluginPanelInstanceOpenResult,
  PluginPanelInstanceOptions,
  PluginPanelInstanceSnapshot,
  PluginPanelRegistration,
  RendererPluginPanelsFacade,
} from "./renderer-panels.ts";

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
  /**
   * 返回 true 时该 action 从右键菜单整行移除（非置灰）。
   * 仅 context menu 投影读取；命令面板/快捷键路径不读此字段。
   */
  menuHidden?: (invocation?: RendererPluginActionInvocation) => boolean;
  /**
   * 自身没有生效的 keybinding 时，菜单和命令面板展示可借用另一条 command。
   */
  shortcutSourceId?: string;
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
  disabledReason?: (
    invocation?: RendererPluginActionInvocation
  ) => null | string | undefined;
  enabled?: (invocation?: RendererPluginActionInvocation) => boolean;
  handler: (
    invocation?: RendererPluginActionInvocation
  ) => Promise<void> | void;
  id: string;
  metadata?: RendererPluginActionMetadata;
  surfaces?: readonly (string & {})[];
  /** 可读取 invocation（如右键 metadata）生成动态标题。 */
  title: (invocation?: RendererPluginActionInvocation) => string;
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
  readonly icon?: ComponentType<{ className?: string; size?: number | string }>;
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
  /**
   * true = 跳过宿主 quickPickResults 重排, 保留插件/主进程给出的顺序
   * (如 path query top-K 排名)。
   */
  readonly preserveItemOrder?: boolean;
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
  /** 后台/系统事件：除 toast 外同时落入宿主消息中心（kind=plugin.event，source=插件 id）。 */
  systemEvent?: boolean;
}

export type RendererPluginAgentSelection = AgentSelectionResult;

export interface RendererPluginTerminalContext {
  activePanelId(): string | null;
  getPanelContext(panelId: string): PanelContext | null;
  onOpenUrl(cb: (event: TerminalOpenUrlEvent) => void): () => void;
  readSelectionText(panelId?: string): Promise<TerminalSelectionTextResult>;
}

export interface RendererPluginTerminalOpenRequest {
  focus?: boolean;
  launch?: TerminalLaunchOptions;
  placement?:
    | "active-tab"
    | "split-above"
    | "split-below"
    | "split-left"
    | "split-right";
}

export interface RendererPluginTerminalOpenResult {
  panelId: string;
  windowId: string;
}

/**
 * 打开宿主终端 panel 的高层入口（区别于单数 `terminal`：读选区/事件）。
 * 带 launch 参数需要 `terminal:control`；main 侧命令层同规则二次校验。
 */
export interface RendererPluginTerminalsContext {
  open(
    request?: RendererPluginTerminalOpenRequest
  ): Promise<RendererPluginTerminalOpenResult>;
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
    updateQuickPick(
      patch: Partial<RendererPluginQuickPick>,
      options?: { signal?: AbortSignal }
    ): void;
  };
  /** 统一评论能力(对应 main CommentsService;插件按 manifest 声明 comments:read/write)。 */
  comments: RendererPluginCommentsFacade;
  configuration: PluginConfigurationApi;
  /**
   * Host fullscreen content preview (image lightbox). Prefer this over nesting
   * a product Dialog for media zoom.
   */
  contentPreview: {
    close(): void;
    openImage(request: {
      alt?: string;
      /** Fixed overlay color mode (e.g. baked reading paper); omit = app theme. */
      colorMode?: "light" | "dark";
      /** Release media owned by this preview when it closes or is replaced. */
      onClose?: () => void;
      source: { kind: "url"; src: string };
      title: string;
    }): void;
  };
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
    /**
     * 注册面板级选区文本提供者（如 Diff 行选区）。
     * panelId 必须是 dockview panel id；返回 disposer。
     */
    registerSelectionTextProvider(
      panelId: string,
      provider: () => string
    ): () => void;
    /**
     * 注册面板级「全选」实现。panelId 必须是 dockview panel id。
     */
    registerSelectionSelectAllProvider(
      panelId: string,
      provider: () => boolean
    ): () => void;
  };
  /**
   * 宿主级模态弹窗。简单决策走 alert/confirm/choice/prompt（AppDialogHost）；
   * 多控件/多步/等待态走 open/update/close（AppContentDialogHost）。
   */
  dialogs: RendererPluginDialogsFacade;
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
    /** Drop every claimed host for this plugin (stale overlays after HMR / layout). */
    clearAll(): void;
    release(input: { groupId: string; id: string; ownerId: symbol }): void;
  };
  /**
   * HTML 文件预览票据（沙箱 iframe 用）。签发的 URL 只在本窗口本 session
   * 可访问；重载预览时用 previousTicket 轮换，卸载时 release。
   */
  htmlPreviews: {
    issue(
      input: { path: string; root: string },
      previousTicket?: string
    ): Promise<HtmlPreviewTicketIssueResult>;
    release(ticket: string): Promise<boolean>;
    touch(ticket: string): Promise<boolean>;
  };
  i18n: {
    commandDescription(commandId: string): string | undefined;
    commandTitle(commandId: string, fallback?: string): string;
    language(): string;
    t(
      key: string,
      values?: RendererPluginMessageValues,
      fallback?: string,
      /** 覆盖 i18next.language；review 投影等必须用 appearance.locale。 */
      locale?: string
    ): string;
  };
  lifecycle: {
    beforeSuspend(participant: RendererPluginSuspendParticipant): () => void;
  };
  /**
   * Host Live Modules (C 轨). Compile canvases; watch via
   * `onChanged` (`pier://live-modules:changed`). Recompile on `stale`.
   */
  liveModules: import("./live-modules-context.ts").RendererLiveModulesApi;
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
  panels: RendererPluginPanelsFacade;
  projectMemory: RendererPluginProjectMemoryFacade;
  projectSettings: {
    register(registration: RendererProjectSettingsRegistration): () => void;
  };
  settings: {
    /** 关闭设置弹窗(经宿主 leave guard);用于从设置深链进工作区的动作。 */
    close(): void;
    openSection(section: "environment"): void;
  };
  terminal: RendererPluginTerminalContext;
  terminalStatusItems: {
    register(item: RendererTerminalStatusItem): () => void;
  };
  terminals: RendererPluginTerminalsContext;
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
