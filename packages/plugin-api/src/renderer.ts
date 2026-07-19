import type { ComponentType, ReactNode } from "react";

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

export interface WorkbenchGridSize {
  h: number;
  w: number;
}

export interface WorkbenchWidgetComponentProps {
  /** Instance id. Multi-instance widgets use this as their persistence scope. */
  instanceId: string;
  /** Widget-private persisted params. Plugins own validation and fallback. */
  params: Readonly<Record<string, JsonValue>>;
  /** Incremented when the user triggers widget refresh. */
  refreshToken: number;
  /** Grid size in cells. Use container queries for visual responsiveness. */
  size: WorkbenchGridSize;
  /** Shallow-merge params patch back into the host panel state. */
  updateParams: (patch: Record<string, JsonValue>) => void;
  /** Current Workbench panel visibility. Polling widgets should pause when false. */
  visible: boolean;
}

export interface WorkbenchWidgetSettingsProps {
  instanceId: string;
  params: Readonly<Record<string, JsonValue>>;
  updateParams: (patch: Record<string, JsonValue>) => void;
}

export interface WorkbenchWidgetActionContext {
  instanceId: string;
  params: Readonly<Record<string, JsonValue>>;
  requestRefresh(): void;
  updateParams(patch: Record<string, JsonValue>): void;
}

export interface RendererWorkbenchWidgetAction {
  disabled?: boolean;
  icon: ComponentType<{ size?: number | string }>;
  id: string;
  intent?: "default" | "destructive";
  invoke(context: WorkbenchWidgetActionContext): Promise<void> | void;
  label: string | (() => string);
  priority?: number;
}

export interface RendererWorkbenchWidgetRegistration {
  actions?(
    context: WorkbenchWidgetActionContext
  ): readonly RendererWorkbenchWidgetAction[];
  component: ComponentType<WorkbenchWidgetComponentProps>;
  icon?: ComponentType<{ size?: number | string }>;
  id: string;
  /** 物料库预览卡（样例数据静态渲染，宿主以 pointer-events-none 展示）。 */
  previewComponent?: ComponentType;
  /** Settings panel. Required when the manifest contribution is configurable. */
  settingsComponent?: ComponentType<WorkbenchWidgetSettingsProps>;
  /** 省略时用 manifest 本地化标题（locales.<lang>.workbenchWidgets）。 */
  title?: string | (() => string);
}

export interface RendererPluginAction {
  category?: string;
  id: string;
  invoke: () => void | Promise<void>;
  title: string | (() => string);
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

export type RendererPluginDialogIntent = "default" | "destructive";
export type RendererPluginDialogSize = "default" | "sm";

export type RendererPluginContentDialogSize = "sm" | "default" | "lg";

export interface RendererPluginContentDialogRenderProps<TResult = unknown> {
  close: (result?: TResult | null) => void;
  id: string;
  setDescription: (description?: string) => void;
  setDismissible: (dismissible: boolean) => void;
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

export interface ExternalRendererPluginContext {
  actions: {
    register(action: RendererPluginAction): () => void;
  };
  app: {
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
  configuration: {
    get<T = unknown>(key: string): T;
    onDidChange(
      cb: (event: { changedKeys: readonly string[] }) => void
    ): () => void;
    reset(key: string): Promise<void>;
    set(key: string, value: unknown): Promise<void>;
  };
  dialogs: {
    alert(options: {
      body?: string;
      confirmLabel?: string;
      intent?: RendererPluginDialogIntent;
      size?: RendererPluginDialogSize;
      title: string;
    }): Promise<void>;
    choice(options: {
      altLabel: string;
      body?: string;
      cancelLabel?: string;
      confirmLabel: string;
      intent: RendererPluginDialogIntent;
      size: RendererPluginDialogSize;
      title: string;
    }): Promise<"alt" | "cancel" | "confirm">;
    confirm(options: {
      body?: string;
      cancelLabel?: string;
      confirmLabel?: string;
      intent: RendererPluginDialogIntent;
      size: RendererPluginDialogSize;
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
      size: RendererPluginDialogSize;
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
  i18n: {
    language(): string;
    t(key: string, fallback?: string): string;
  };
  lifecycle: {
    beforeSuspend(participant: RendererPluginSuspendParticipant): () => void;
  };
  notifications: {
    error(message: string): void;
    info(message: string): void;
    success(message: string): void;
  };
  panels: {
    register(registration: RendererPluginPanelRegistration): () => void;
  };
  rpc: {
    invoke<T = unknown>(method: string, payload?: unknown): Promise<T>;
    on<T = unknown>(event: string, callback: (payload: T) => void): () => void;
  };
  settingsPages: {
    register(registration: RendererSettingsPageRegistration): () => void;
  };
  workbenchWidgets: {
    register(registration: RendererWorkbenchWidgetRegistration): () => void;
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
