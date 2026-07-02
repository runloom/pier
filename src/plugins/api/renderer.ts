import type { IDockviewPanelProps } from "@shared/contracts/dockview.ts";
import type {
  GitBranchRef,
  GitChangeEvent,
  GitDiffBranchesResult,
  GitMergeAbortResult,
  GitMergeResult,
  GitRebaseAbortResult,
  GitRebaseContinueResult,
  GitRebaseResult,
  GitRepoInfo,
  GitStashListResult,
  GitStashPopResult,
  GitStashResult,
  GitStatus,
  GitUndoCommitResult,
} from "@shared/contracts/git.ts";
import type { PanelContext } from "@shared/contracts/panel.ts";
import type {
  WorktreeCheckRequest,
  WorktreeCheckResult,
  WorktreeCreateRequest,
  WorktreeCreateResult,
  WorktreeCreationDefaults,
  WorktreeListRequest,
  WorktreeListResult,
  WorktreeOpenRequest,
  WorktreeOpenTerminalRequest,
  WorktreePruneRequest,
  WorktreeRemoveRequest,
  WorktreeRemoveResult,
} from "@shared/contracts/worktree.ts";
import type { LucideIcon } from "lucide-react";
import type { FunctionComponent, ReactNode } from "react";

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
  | "worktree";

export interface RendererPluginActionMetadata {
  categoryKey?: RendererPluginActionCategoryKey;
  excludeFromMru?: boolean;
  group?: string;
  iconComponent?: LucideIcon;
  sortOrder?: number;
  submenu?: () => string;
}

export interface RendererPluginAction {
  category: string;
  disabledReason?: () => null | string | undefined;
  enabled?: () => boolean;
  handler: () => Promise<void> | void;
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
  readonly id: string;
  readonly label: string;
  readonly searchTerms?: readonly string[];
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
  description?: string;
}

export interface RendererPluginContext {
  actions: {
    register(action: RendererPluginAction): () => void;
  };
  commandPalette: {
    openQuickPick(quickPick: RendererPluginQuickPick): void;
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
      title: string;
    }): Promise<void>;
    confirm(options: {
      body?: string;
      cancelLabel?: string;
      confirmLabel?: string;
      title: string;
    }): Promise<boolean>;
  };
  /**
   * Git 主体能力(对应 main 进程 GitService;插件按 manifest 声明的 capability 调用)。
   * 这里仅做 preload facade 的窄透传,git 业务交互仍由插件自己实现。
   */
  git: {
    abortMerge(cwd: string): Promise<GitMergeAbortResult>;
    abortRebase(cwd: string): Promise<GitRebaseAbortResult>;
    continueRebase(cwd: string): Promise<GitRebaseContinueResult>;
    getStatus(cwd: string): Promise<GitStatus>;
    getRepoInfo(cwd: string): Promise<GitRepoInfo>;
    listBranches(
      cwd: string,
      options: { kind: "all" | "local" | "remote" }
    ): Promise<GitBranchRef[]>;
    searchBranches(
      cwd: string,
      options?: {
        currentBranch?: null | string;
        limit?: number;
        query?: string;
      }
    ): Promise<GitDiffBranchesResult>;
    listStashes(cwd: string): Promise<GitStashListResult>;
    merge(cwd: string, branch: string): Promise<GitMergeResult>;
    popStash(cwd: string, index?: number): Promise<GitStashPopResult>;
    rebase(cwd: string, branch: string): Promise<GitRebaseResult>;
    stash(
      cwd: string,
      options?: { includeUntracked?: boolean; message?: string }
    ): Promise<GitStashResult>;
    undoLastCommit(cwd: string): Promise<GitUndoCommitResult>;
    watch(
      gitRoot: string,
      listener: (event: GitChangeEvent) => void
    ): () => void;
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
    getActiveContext(): PanelContext | null;
    /**
     * 单例打开指定 panel。panelId 必须在本插件 manifest 的 panels[] 中声明 ——
     * 不支持打开其它插件贡献的 panel(权限/所有权对称约束)。
     */
    open(panelId: string, options?: { context?: PanelContext }): void;
    register(registration: PluginPanelRegistration): () => void;
  };
  terminalStatusItems: {
    register(item: RendererTerminalStatusItem): () => void;
  };
  worktrees: {
    check(request: WorktreeCheckRequest): Promise<WorktreeCheckResult>;
    create(request: WorktreeCreateRequest): Promise<WorktreeCreateResult>;
    creationDefaults(): Promise<WorktreeCreationDefaults>;
    list(request: WorktreeListRequest): Promise<WorktreeListResult>;
    open(request: WorktreeOpenRequest): Promise<unknown>;
    openTerminal(request: WorktreeOpenTerminalRequest): Promise<unknown>;
    prune(request: WorktreePruneRequest): Promise<WorktreeListResult>;
    remove(request: WorktreeRemoveRequest): Promise<WorktreeRemoveResult>;
  };
}

export interface RendererPluginModule {
  activate(context: RendererPluginContext): () => void;
  id: string;
}
