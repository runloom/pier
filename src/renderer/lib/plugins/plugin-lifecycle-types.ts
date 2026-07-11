export type RendererPluginSuspendReason =
  | "app-quit"
  | "plugin-disable"
  | "plugin-reload"
  | "runtime-dispose"
  | "runtime-refresh"
  | "window-close";

export interface CommittedReceiptLease {
  isCurrent(): boolean;
  transitionId: string;
}

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

export type RendererPluginSuspendBarrier = (
  reason: RendererPluginSuspendReason
) => Promise<void> | void;

export interface RunBarrierOptions {
  timeoutMs?: number;
}

export interface RegisteredParticipant {
  participant: RendererPluginSuspendParticipant;
  pluginId: string;
}

export interface SuspendSession {
  controller: AbortController;
  participants: readonly RegisteredParticipant[];
  preparation: Promise<void>;
  reason: RendererPluginSuspendReason;
  status: "prepared" | "preparing";
  transitionId: string;
}

export const DEFAULT_BARRIER_TIMEOUT_MS = 10_000;
export const MAX_COMPLETED_TRANSITIONS = 128;
