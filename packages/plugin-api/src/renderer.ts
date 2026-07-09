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

export interface MissionControlGridSize {
  h: number;
  w: number;
}

export interface MissionControlWidgetComponentProps {
  /** Instance id. Multi-instance widgets use this as their persistence scope. */
  instanceId: string;
  /** Widget-private persisted params. Plugins own validation and fallback. */
  params: Readonly<Record<string, JsonValue>>;
  /** Incremented when the user triggers widget refresh. */
  refreshToken: number;
  /** Grid size in cells. Use container queries for visual responsiveness. */
  size: MissionControlGridSize;
  /** Shallow-merge params patch back into the host panel state. */
  updateParams: (patch: Record<string, JsonValue>) => void;
  /** Current Mission Control panel visibility. Polling widgets should pause when false. */
  visible: boolean;
}

export interface MissionControlWidgetSettingsProps {
  instanceId: string;
  params: Readonly<Record<string, JsonValue>>;
  updateParams: (patch: Record<string, JsonValue>) => void;
}

export interface RendererMissionControlWidgetRegistration {
  component: ComponentType<MissionControlWidgetComponentProps>;
  icon?: ComponentType<{ size?: number | string }>;
  id: string;
  /** 物料库预览卡（样例数据静态渲染，宿主以 pointer-events-none 展示）。 */
  previewComponent?: ComponentType;
  /** Settings panel. Required when the manifest contribution is configurable. */
  settingsComponent?: ComponentType<MissionControlWidgetSettingsProps>;
  /** 省略时用 manifest 本地化标题（locales.<lang>.missionControlWidgets）。 */
  title?: string | (() => string);
}

export interface RendererPluginAction {
  category?: string;
  id: string;
  invoke: () => void | Promise<void>;
  title: string | (() => string);
}

export interface RendererSettingsPageRegistration {
  component: ComponentType<Record<string, never>>;
  id: string;
}

export interface ExternalRendererPluginContext {
  actions: {
    register(action: RendererPluginAction): () => void;
  };
  app: {
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
    alert(options: { body?: string; title: string }): Promise<void>;
    confirm(options: {
      body?: string;
      title: string;
      intent?: "default" | "destructive";
    }): Promise<boolean>;
  };
  i18n: {
    t(key: string, fallback?: string): string;
  };
  missionControlWidgets: {
    register(
      registration: RendererMissionControlWidgetRegistration
    ): () => void;
  };
  notifications: {
    error(message: string): void;
    info(message: string): void;
    success(message: string): void;
  };
  rpc: {
    invoke<T = unknown>(method: string, payload?: unknown): Promise<T>;
    on<T = unknown>(event: string, callback: (payload: T) => void): () => void;
  };
  settingsPages: {
    register(registration: RendererSettingsPageRegistration): () => void;
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
