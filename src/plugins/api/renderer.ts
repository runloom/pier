import type {
  GitChangeEvent,
  GitRepoInfo,
  GitStatus,
} from "@shared/contracts/git.ts";
import type { PanelContext } from "@shared/contracts/panel.ts";
import type {
  WorktreeCheckRequest,
  WorktreeCheckResult,
  WorktreeListRequest,
  WorktreeListResult,
  WorktreeOpenRequest,
} from "@shared/contracts/worktree.ts";
import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

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
  aliases?: () => readonly string[];
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

export interface RendererPluginContext {
  actions: {
    register(action: RendererPluginAction): () => void;
  };
  commandPalette: {
    openQuickPick(quickPick: RendererPluginQuickPick): void;
  };
  /**
   * Git 主体能力(对应 main 进程 GitService;插件按 manifest 声明的 capability 调用)。
   * 只暴露插件常用的 3 个方法,其他按需扩展。
   */
  git: {
    getStatus(cwd: string): Promise<GitStatus>;
    getRepoInfo(cwd: string): Promise<GitRepoInfo>;
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
  panels: {
    getActiveContext(): PanelContext | null;
  };
  terminalStatusItems: {
    register(item: RendererTerminalStatusItem): () => void;
  };
  worktrees: {
    check(request: WorktreeCheckRequest): Promise<WorktreeCheckResult>;
    list(request: WorktreeListRequest): Promise<WorktreeListResult>;
    open(request: WorktreeOpenRequest): Promise<unknown>;
  };
}

export interface RendererPluginModule {
  activate(context: RendererPluginContext): () => void;
  id: string;
}
