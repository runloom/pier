import type { ComponentType, ReactNode } from "react";

/**
 * External renderer plugin context. Deliberately account-free — the Codex
 * plugin owns its own account domain via plugin-scoped RPC (design §7.2).
 *
 * NEVER re-export host `RendererPluginContext` from `src/plugins/api/renderer.ts`
 * — that type still exposes host-specific facades that would upgrade external
 * plugin coupling into a de-facto host API.
 */

export interface MissionControlWidgetComponentProps {
  height: number;
  width: number;
}

export interface RendererMissionControlWidgetRegistration {
  component: ComponentType<MissionControlWidgetComponentProps>;
  icon?: ComponentType<{ size?: number | string }>;
  id: string;
  title: string | (() => string);
}

export interface RendererPluginAction {
  category?: string;
  id: string;
  invoke: () => void | Promise<void>;
  title: string | (() => string);
}

export interface ExternalRendererPluginContext {
  actions: {
    register(action: RendererPluginAction): () => void;
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
    confirm(options: { body?: string; title: string }): Promise<boolean>;
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
