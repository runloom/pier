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

export interface RendererPluginActionMetadata {
  excludeFromMru?: boolean;
  group?: string;
  iconComponent?: LucideIcon;
  keywords?: readonly string[];
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
  readonly badges?: readonly RendererPluginQuickPickItemBadge[];
  readonly checked?: boolean;
  readonly description?: string;
  readonly detail?: string;
  readonly disabled?: boolean;
  readonly id: string;
  readonly keywords?: readonly string[];
  readonly label: string;
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
