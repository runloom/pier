import type {
  TerminalFrame,
  TerminalInputRoutingSnapshot,
  TerminalKeyboardFocusTarget,
  TerminalNativeInputRoutingSnapshot,
  TerminalNativePresentationSnapshot,
  TerminalPresentationSnapshot,
} from "./terminal.ts";

export interface TerminalDebugPresentationSnapshot {
  desired?: TerminalPresentationSnapshot | undefined;
  effective?: TerminalNativePresentationSnapshot | undefined;
}

export interface TerminalDebugInputRoutingSnapshot {
  desired?: TerminalInputRoutingSnapshot | undefined;
  effective?: TerminalNativeInputRoutingSnapshot | undefined;
}

export type TerminalDebugRoute =
  | "renderer->main->native"
  | "renderer->main->webContents"
  | "native->main->renderer";

export interface TerminalDebugEvent {
  action: string;
  at: string;
  browserWindowId: number;
  detail?: Record<string, boolean | number | string | null> | undefined;
  id: number;
  nativePanelId?: string | undefined;
  panelId?: string | undefined;
  route: TerminalDebugRoute;
  windowId?: string | undefined;
}

export type TerminalDebugRouterDecisionKind =
  | "hit-test"
  | "key-down"
  | "right-mouse";

export type TerminalDebugRouterDecisionPayload = Record<
  string,
  boolean | number | string | null
>;

/**
 * EventRouterView 每次 hitTest / keyDown / rightMouseDown 的一条判定记录, 由 native
 * 侧 ring buffer 维护 (上限 64 条). 供 debug window 复盘 "看得见但点不到 / 按键不
 * 到 terminal" 类问题 — 光看瞬时状态看不出事件流向哪里, 决策序列能定位是 hitTest
 * miss 还是 basePanel 指错.
 *
 * `seq` 是 EventRouterView 实例内单调递增, 供 renderer 稳定 React key; ring buffer
 * 逐出旧条时 seq 不复用, 保证跨 refresh 的行 identity 稳定.
 */
export interface TerminalDebugRouterDecision {
  at: number;
  kind: TerminalDebugRouterDecisionKind;
  payload: TerminalDebugRouterDecisionPayload;
  seq: number;
}

export interface TerminalDebugNativeWindowSnapshot {
  activeTerminalPanelId: string | null;
  inputRoutingStaleDiscardCount?: number | undefined;
  keyboardFocusTarget: TerminalKeyboardFocusTarget;
  lastAppliedInputRoutingSequence?: number | undefined;
  lastAppliedNativeApplySequence?: number | undefined;
  lastAppliedRendererSequence?: number | undefined;
  lastPresentationReason?: string | undefined;
  nativeActiveTerminalPanelId: string | null;
  recentRouterDecisions?: TerminalDebugRouterDecision[] | undefined;
  /**
   * 未知 kind / 非 primitive payload 值被 normalize 静默丢弃的条数. UI 展示成 "N/64
   * (M dropped)" 提醒 native 或 schema 已经跑偏; 否则用户会以为 ring buffer 就是空的.
   */
  routerDecisionsDroppedCount?: number | undefined;
  staleDiscardCount?: number | undefined;
  terminalTargetCount: number;
  webOverlayRectCount: number;
}

export interface TerminalDebugNativeSurfaceSnapshot {
  alpha: number;
  browserWindowId: number;
  cursorSuppressed?: boolean | undefined;
  frame: TerminalFrame;
  hasRouterTarget: boolean;
  hostKeyboardActive?: boolean | undefined;
  isFirstResponder: boolean;
  isHidden: boolean;
  isOffscreen: boolean;
  isSurfaceFocused?: boolean | undefined;
  nativePanelId: string;
  panelId: string;
  surfaceVisible?: boolean | undefined;
  targetRect?: TerminalFrame | null | undefined;
  viewportFrame?: TerminalFrame | null | undefined;
}

export interface TerminalDebugNativeSnapshot {
  error?: string | undefined;
  surfaces: TerminalDebugNativeSurfaceSnapshot[];
  window: TerminalDebugNativeWindowSnapshot;
}

export type TerminalDebugIssueSeverity = "error" | "warning";

export interface TerminalDebugIssue {
  code:
    | "duplicate_renderer_panel"
    | "desired_frame_native_mismatch"
    | "desired_hidden_native_visible"
    | "desired_visible_native_hidden"
    | "frame_mismatch"
    | "input_routing_keyboard_first_responder_mismatch"
    | "input_routing_keyboard_target_mismatch"
    | "input_routing_overlay_rect_count_mismatch"
    | "input_routing_stale"
    | "input_routing_terminal_cursor_policy_mismatch"
    | "input_routing_terminal_target_missing"
    | "input_routing_terminal_surface_focus_mismatch"
    | "native_hidden_while_anchor_visible"
    | "native_missing"
    | "orphan_native_surface"
    | "presentation_stale"
    | "renderer_terminal_create_pending"
    | "renderer_terminal_lifecycle_missing"
    | "renderer_terminal_placeholder_visible";
  message: string;
  panelId?: string | undefined;
  severity: TerminalDebugIssueSeverity;
}

export type TerminalDebugRendererTerminalPhase =
  | "creating"
  | "disposed"
  | "error"
  | "mounted"
  | "ready"
  | "waiting_for_session"
  | "waiting_for_anchor";

export interface TerminalDebugRendererTerminalLifecycleSnapshot {
  createAttemptCount: number;
  createPending: boolean;
  didCreateNativeTerminal: boolean;
  error: string | null;
  hasRenderableAnchor: boolean;
  nativeTerminalReady: boolean;
  phase: TerminalDebugRendererTerminalPhase;
  placeholderVisible: boolean;
  updatedAt: number;
}

export interface TerminalDebugRendererPanelSnapshot {
  anchorFrame: TerminalFrame | null;
  component: string;
  dockviewActive: boolean;
  dockviewVisible: boolean;
  hasAnchor: boolean;
  isActivePanel: boolean;
  panelId: string;
  resourceMode?:
    | "coldSuspendedCandidate"
    | "visible"
    | "warmHidden"
    | undefined;
  terminalLifecycle?:
    | TerminalDebugRendererTerminalLifecycleSnapshot
    | undefined;
}

export interface TerminalDebugRendererSnapshot {
  activePanelId: string | null;
  desiredInputRouting?: TerminalInputRoutingSnapshot | undefined;
  desiredPresentation?: TerminalPresentationSnapshot | undefined;
  hasMaximizedGroup: boolean;
  panelCount: number;
  panels: TerminalDebugRendererPanelSnapshot[];
  viewportFrame?: TerminalFrame | undefined;
}

export interface TerminalDebugRendererSnapshotRequest {
  requestId: string;
}

export interface TerminalDebugRendererSnapshotResult {
  error?: string | undefined;
  ok: boolean;
  renderer?: TerminalDebugRendererSnapshot | undefined;
  requestId: string;
}

export interface TerminalDebugSnapshotArgs {
  targetBrowserWindowId?: number | undefined;
}

export interface TerminalDebugSnapshot {
  events: TerminalDebugEvent[];
  inputRouting?: TerminalDebugInputRoutingSnapshot | undefined;
  issues?: TerminalDebugIssue[] | undefined;
  native: TerminalDebugNativeSnapshot;
  presentation?: TerminalDebugPresentationSnapshot | undefined;
  renderer?: TerminalDebugRendererSnapshot | undefined;
}

export interface TerminalDebugWindowOpenResult {
  error?: string | undefined;
  ok: boolean;
  targetBrowserWindowId?: number | undefined;
}
