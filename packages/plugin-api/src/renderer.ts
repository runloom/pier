import type { ComponentType, ReactNode } from "react";
import type { GitFileBaselineInput, GitFileBaselineResult } from "./git.ts";

export type { GitFileBaselineInput, GitFileBaselineResult } from "./git.ts";

export type JsonValue =
  | boolean
  | null
  | number
  | string
  | JsonValue[]
  | { [key: string]: JsonValue };

/**
 * External renderer plugin context. Deliberately account-free — the Codex
 * plugin owns its own account domain via plugin-scoped RPC (design §7.2).
 *
 * NEVER re-export host `RendererPluginContext` from `src/plugins/api/renderer.ts`
 * — that type still exposes host-specific facades that would upgrade external
 * plugin coupling into a de-facto host API.
 */

export type RendererPluginActionSurface = "command-palette" | "create-menu";

export interface RendererPluginActionInvocation {
  sourcePanelContext?:
    | {
        contextId: string;
        gitRoot?: string | undefined;
        projectRootPath: string;
        worktreeRoot?: string | undefined;
      }
    | undefined;
  sourcePanelGroupId?: string | undefined;
}

export interface RendererPluginAction {
  category?: string;
  id: string;
  invoke: (invocation?: RendererPluginActionInvocation) => void | Promise<void>;
  /**
   * Where the action appears. Defaults to command palette only.
   * Include `create-menu` so ⌘N can open a plugin panel.
   */
  surfaces?: readonly RendererPluginActionSurface[];
  title: string | (() => string);
}

export interface RendererPluginPanelOpenOptions {
  sourcePanelContext?: RendererPluginActionInvocation["sourcePanelContext"];
  targetGroupId?: string | undefined;
}

export interface RendererPluginAppletRenderRequest {
  appletId: string;
  projectRootPath: string;
  props?: Record<string, unknown>;
}

export interface RendererPluginQuickPickItem {
  readonly aliases?: readonly string[];
  readonly badges?: readonly {
    readonly label: string;
    readonly variant?:
      | "default"
      | "destructive"
      | "ghost"
      | "outline"
      | "secondary";
  }[];
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
  readonly errorText?: string;
  getQueryItem?(query: string): RendererPluginQuickPickItem | null;
  readonly items?: readonly RendererPluginQuickPickItem[];
  readonly loading?: boolean;
  onAccept(item: RendererPluginQuickPickItem): Promise<void> | void;
  onChangeSelection?(item: RendererPluginQuickPickItem): void;
  onDismiss?(): void;
  onQueryChange?(query: string, signal: AbortSignal): Promise<void> | void;
  readonly placeholder?: string;
  readonly preserveItemOrder?: boolean;
  renderItem?(item: RendererPluginQuickPickItem): ReactNode;
  readonly sections?: readonly RendererPluginQuickPickSection[];
  readonly title: string;
}

export interface RendererPluginLoadingNotification {
  dismiss(): void;
  info(message: string): void;
  success(message: string): void;
  update(message: string): void;
}

export interface RendererPluginNotificationOptions {
  action?: { label: string; onClick: () => void };
  /** 后台/系统事件：除 toast 外同时落入宿主消息中心（kind=plugin.event，source=插件 id）。 */
  systemEvent?: boolean;
}

export interface RendererPluginPanelRegistration {
  component: ComponentType<Record<string, unknown>>;
  icon?: ComponentType<{ size?: number | string }>;
  id: string;
  title?: string | (() => string);
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

export interface RendererSettingsPageRegistration {
  component: ComponentType<Record<string, never>>;
  id: string;
}

export interface RendererProjectSettingsRegistration {
  id: string;
  render: (props: {
    isPierHome: boolean;
    projectRootPath: string;
  }) => ReactNode;
  title: () => string;
  visible?: (props: { isPierHome: boolean }) => boolean;
}

export type RendererPluginDialogIntent = "default" | "destructive";

export type RendererPluginContentDialogSize = "sm" | "default" | "lg";

export interface RendererPluginContentDialogRenderProps<TResult = unknown> {
  close: (result?: TResult | null) => void;
  id: string;
  setDescription: (description?: string) => void;
  setDismissible: (dismissible: boolean) => void;
  /** Sticky DialogFooter actions; pass null to hide. */
  setFooter: (footer: ReactNode | null) => void;
  /**
   * Guard header X / Esc / overlay dismiss. Return false to keep the dialog
   * open (e.g. confirm discarding unsaved edits). Prefer over hiding the X.
   */
  setOnDismissRequest: (
    handler: (() => boolean | Promise<boolean>) | null
  ) => void;
  setTitle: (title: string) => void;
}

export interface RendererPluginContentDialogOpenRequest<TResult = unknown> {
  closeOnOverlayClick?: boolean;
  content: ComponentType<RendererPluginContentDialogRenderProps<TResult>>;
  description?: string;
  dismissible?: boolean;
  id: string;
  size?: RendererPluginContentDialogSize;
  title: string;
}

export interface RendererPluginContentDialogHandle<TResult = unknown> {
  close(result?: TResult | null): void;
  id: string;
  result: Promise<TResult | null>;
  update(patch: {
    title?: string;
    description?: string;
    dismissible?: boolean;
    closeOnOverlayClick?: boolean;
  }): void;
}

/**
 * Terminal launch options for `terminals.open`. Structural mirror of the host
 * `TerminalLaunchOptions` contract — plugin-api stays dependency-free, the
 * host validates the payload against its own schema.
 */
export interface TerminalOpenLaunchOptions {
  command?: string;
  cwd?: string;
  env?: Record<string, string>;
  profileId?: string;
}

export interface TerminalOpenRequest {
  focus?: boolean;
  launch?: TerminalOpenLaunchOptions;
  placement?:
    | "active-tab"
    | "split-above"
    | "split-below"
    | "split-left"
    | "split-right";
}

export interface TerminalOpenResult {
  panelId: string;
  windowId: string;
}

export interface ExternalRendererPluginContext {
  actions: {
    register(action: RendererPluginAction): () => void;
  };
  app: {
    /** Close the host settings dialog, e.g. before opening a panel it would cover. */
    closeSettings(): void;
    /**
     * Open a URL in the user's default browser via the host. Requires the
     * `external:open` permission in plugin.json. The host denies renderer
     * `window.open` / navigation outright, so plain `<a target="_blank">`
     * links are dead — always route external links through this API.
     * Resolves `true` when the URL was handed to the OS.
     */
    openExternal(url: string): Promise<boolean>;
    openSettings(options?: { section?: string }): void;
  };
  /**
   * Mount a declared applet (`manifest.applets`) into plugin UI.
   * Host compiles `@pier-applet/<pluginId>/<appletId>` — do not bundle
   * applet source into the plugin renderer.
   */
  applets: {
    render(request: RendererPluginAppletRenderRequest): ReactNode;
  };
  commandPalette: {
    openQuickPick(quickPick: RendererPluginQuickPick): void;
    updateQuickPick(
      patch: Partial<RendererPluginQuickPick>,
      options?: { signal?: AbortSignal }
    ): void;
  };
  configuration: {
    get<T = unknown>(key: string): T;
    onDidChange(
      cb: (event: { changedKeys: readonly string[] }) => void
    ): () => void;
    reset(key: string): Promise<void>;
    set(key: string, value: unknown): Promise<void>;
  };
  /**
   * Simple dialogs: size is host-owned (alert/confirm/prompt → sm, choice →
   * default). Callers must not pass `size`. Longer UI → `open` content dialog.
   */
  dialogs: {
    alert(options: {
      body?: string;
      confirmLabel?: string;
      intent?: RendererPluginDialogIntent;
      title: string;
    }): Promise<void>;
    choice(options: {
      altLabel: string;
      body?: string;
      buttonOrder?: "alt-cancel-confirm" | "confirm-alt-cancel";
      cancelLabel?: string;
      confirmLabel: string;
      intent: RendererPluginDialogIntent;
      title: string;
    }): Promise<"alt" | "cancel" | "confirm">;
    confirm(options: {
      body?: string;
      cancelLabel?: string;
      confirmLabel?: string;
      intent: RendererPluginDialogIntent;
      title: string;
    }): Promise<boolean>;
    open<TResult = unknown>(
      request: RendererPluginContentDialogOpenRequest<TResult>
    ): RendererPluginContentDialogHandle<TResult>;
    prompt(options: {
      body?: string;
      cancelLabel?: string;
      confirmLabel?: string;
      initialValue?: string;
      intent: RendererPluginDialogIntent;
      placeholder?: string;
      title: string;
      validate?: (value: string) => Promise<string | null> | string | null;
    }): Promise<string | null>;
    update(
      id: string,
      patch: {
        title?: string;
        description?: string;
        dismissible?: boolean;
        closeOnOverlayClick?: boolean;
      }
    ): void;
    close(id: string, result?: unknown): void;
  };
  /** Reads immutable HEAD text for a Files local diff. Requires git:read. */
  git: {
    getFileBaseline(
      input: GitFileBaselineInput
    ): Promise<GitFileBaselineResult>;
  };
  i18n: {
    language(): string;
    t(key: string, fallback?: string): string;
  };
  lifecycle: {
    beforeSuspend(participant: RendererPluginSuspendParticipant): () => void;
  };
  notifications: {
    error(message: string, options?: RendererPluginNotificationOptions): void;
    info(message: string, options?: RendererPluginNotificationOptions): void;
    loading(message: string): RendererPluginLoadingNotification;
    success(message: string, options?: RendererPluginNotificationOptions): void;
  };
  panels: {
    open(panelId: string, options?: RendererPluginPanelOpenOptions): void;
    register(registration: RendererPluginPanelRegistration): () => void;
  };
  projectSettings: {
    register(registration: RendererProjectSettingsRegistration): () => void;
  };
  rpc: {
    invoke<T = unknown>(method: string, payload?: unknown): Promise<T>;
    on<T = unknown>(event: string, callback: (payload: T) => void): () => void;
  };
  settingsPages: {
    register(registration: RendererSettingsPageRegistration): () => void;
  };
  /**
   * Open a host terminal panel (PierCommand `terminal.open`). Requires the
   * `terminal:control` capability in the plugin manifest.
   */
  terminals: {
    open(request?: TerminalOpenRequest): Promise<TerminalOpenResult>;
  };
  /**
   * Git working-tree facade. Structural mirror of the host worktrees API —
   * plugin-api stays dependency-free. Requires `worktree:read` / `worktree:write`.
   */
  worktrees: {
    check(request: { path: string }): Promise<{
      currentPath?: string | undefined;
      mainPath?: string | undefined;
      path: string;
      reason?: string | undefined;
      status: "supported" | "unsupported";
    }>;
    create(request: {
      base?: string | undefined;
      branch: string;
      name: string;
      path: string;
      runSetupBeforeReturn?: boolean | undefined;
    }): Promise<{
      pendingSetupCommand?: string | undefined;
      targetPath: string;
    }>;
    openTerminal(request: {
      agentId?: string | undefined;
      initialCommand?: string | undefined;
      path: string;
      taskPrompt?: string | undefined;
    }): Promise<{ panelId: string }>;
    remove(request: {
      currentPath?: string | undefined;
      deleteBranch?: boolean | undefined;
      path: string;
    }): Promise<{ removedPath: string }>;
  };
}

export interface ExternalRendererPluginModule {
  activate(context: ExternalRendererPluginContext): () => void;
  icon?: ComponentType<{ size?: number | string }>;
  id: string;
}

export interface PluginRpcError {
  code: string;
  details?: unknown;
  diagnosticId?: string;
  message: string;
}

// ReactNode re-export lets plugin authors typecheck against a stable node type
// without pulling `react` directly.
export type PluginReactNode = ReactNode;
