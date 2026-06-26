import type { PanelContext } from "./panel.ts";

export interface TerminalFrame {
  height: number;
  width: number;
  x: number;
  y: number;
}

export type TerminalPresentationReason =
  | "anchor-resize"
  | "dockview-active-panel"
  | "dockview-dimensions"
  | "dockview-layout"
  | "dockview-maximize"
  | "overlay"
  | "restore"
  | "visibility"
  | "window-blur"
  | "window-focus"
  | "window-resize"
  | `window-${"resize" | "zoom"}`;

export interface TerminalPresentationEntry {
  focused: boolean;
  frame: TerminalFrame | null;
  panelId: string;
  visible: boolean;
}

export interface TerminalPresentationSnapshot {
  activePanelId: string | null;
  activePanelKind: "terminal" | "web";
  hasMaximizedGroup: boolean;
  overlayActive: boolean;
  reason: TerminalPresentationReason;
  rendererSequence: number;
  terminals: TerminalPresentationEntry[];
}

export interface TerminalNativePresentationSnapshot
  extends TerminalPresentationSnapshot {
  nativeApplySequence: number;
  windowFocused: boolean;
}

export interface TerminalDebugPresentationSnapshot {
  desired?: TerminalPresentationSnapshot | undefined;
  effective?: TerminalNativePresentationSnapshot | undefined;
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

export interface TerminalDebugNativeWindowSnapshot {
  activePanelKind: "terminal" | "web";
  activeTerminalPanelId: string | null;
  inTerminalMode: boolean;
  lastAppliedNativeApplySequence?: number | undefined;
  lastAppliedRendererSequence?: number | undefined;
  lastPresentationReason?: string | undefined;
  nativeActiveTerminalPanelId: string | null;
  overlayActive: boolean;
  staleDiscardCount?: number | undefined;
}

export interface TerminalDebugNativeSurfaceSnapshot {
  alpha: number;
  browserWindowId: number;
  frame: TerminalFrame;
  hasRouterTarget: boolean;
  isFirstResponder: boolean;
  isHidden: boolean;
  isOffscreen: boolean;
  nativePanelId: string;
  panelId: string;
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
    | "desired_focus_native_first_responder_mismatch"
    | "desired_frame_native_mismatch"
    | "desired_hidden_native_visible"
    | "desired_visible_native_hidden"
    | "frame_mismatch"
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
  terminalLifecycle?:
    | TerminalDebugRendererTerminalLifecycleSnapshot
    | undefined;
}

export interface TerminalDebugRendererSnapshot {
  activePanelId: string | null;
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

/**
 * Terminal 字体配置. family 已在 renderer 侧调 computeMonoFontFamily 处理过 fallback
 * 链, native 端拿到的是完整 font-family 字符串 (含逗号分隔的 fallback). size 单位 px,
 * 范围 8-32 (由 preferences zod 守住).
 */
export interface TerminalFont {
  family: string;
  size: number;
}

export type TerminalCursorStyle = "block" | "bar" | "underline";

export interface TerminalRuntimeConfig {
  cursorBlink: boolean;
  cursorStyle: TerminalCursorStyle;
  pasteProtection: boolean;
  scrollbackLimitBytes: number;
}

export interface CreateTerminalArgs {
  context?: PanelContext | undefined;
  font: TerminalFont;
  frame: TerminalFrame;
  panelId: string;
}

export interface CreateTerminalResult {
  error?: string;
  ok: boolean;
}

export interface TerminalContextMenuRequest {
  panelId: string;
  /** BrowserWindow contentView 坐标 (top-left origin, flipped). */
  x: number;
  y: number;
}

export interface TerminalFocusRequest {
  panelId: string;
}

/**
 * Terminal cwd 变化事件 — swift OSC 7 解析后通过 IPC 推送到 renderer.
 * cwd 是绝对路径 (file:// 前缀已由 swift 端从 URL 提取掉).
 */
export interface TerminalCwdEvent {
  context: PanelContext;
  panelId: string;
}

/**
 * Terminal title 变化事件 — swift OSC 0/2 解析后通过 IPC 推送到 renderer.
 * title 是 TUI 应用 (claude / vim / aider) 主动设置的自定义 window title,
 * descriptor.long 的最高优先级来源.
 */
export interface TerminalTitleEvent {
  panelId: string;
  title: string;
}

export interface TerminalPanelSessionSnapshot {
  context?: PanelContext | undefined;
  title?: string | undefined;
  updatedAt: string;
}

export type TerminalOperation = "copy" | "paste" | "selectAll" | "clearScreen";

export interface TerminalOperationResult {
  error?: string | undefined;
  ok: boolean;
}
/**
 * ANSI 16 色 palette. 索引语义 = xterm-256color 前 16 槽:
 * 0..7   = black, red, green, yellow, blue, magenta, cyan, white
 * 8..15  = bright black .. bright white
 *
 * 每项是 #RRGGBB (6 字符, 不含 alpha) — Ghostty 库接收 hex 字符串.
 */
export type AnsiPalette = readonly [
  string,
  string,
  string,
  string,
  string,
  string,
  string,
  string,
  string,
  string,
  string,
  string,
  string,
  string,
  string,
  string,
];

/**
 * 终端配色描述. 由 renderer 侧从当前 Shiki 主题派生, 经 IPC → native addon →
 * Ghostty controller.setTheme 应用. 所有色值都是 #RRGGBB (含 #, 6 字符).
 *
 * cursor / selectionBackground / selectionForeground 写成 `| undefined` 而非纯
 * optional, 是因为项目 tsconfig 启用 exactOptionalPropertyTypes — derive 函数
 * 会显式赋 undefined 表示"主题缺这个键", IPC 边界用 isString 守卫区分缺失
 * vs 实际值.
 */
export interface TerminalColors {
  background: string;
  cursor?: string | undefined;
  foreground: string;
  palette: AnsiPalette;
  selectionBackground?: string | undefined;
  selectionForeground?: string | undefined;
}

export interface TerminalAPI {
  applyPresentation(snapshot: TerminalPresentationSnapshot): void;
  applyTheme(colors: TerminalColors): void;
  /**
   * 关闭 terminal panel 的 native NSView. fire-and-forget — swift 端 close 是同步
   * 调用, 调用方不需要 await. 调用 idempotent (panelId 不存在时 no-op).
   */
  close(panelId: string): void;
  create(args: CreateTerminalArgs): Promise<CreateTerminalResult>;
  debugSnapshot(
    args?: TerminalDebugSnapshotArgs
  ): Promise<TerminalDebugSnapshot>;
  focus(panelId: string): void;
  hide(panelId: string): void;
  /** 订阅 swift 转发的右键事件. 返回 unsubscribe. */
  onContextMenuRequest: (
    cb: (req: TerminalContextMenuRequest) => void
  ) => () => void;
  /**
   * 订阅 terminal cwd 变化. 回调返回 dispose 函数, 调用即取消订阅.
   * 每次调用建立一个独立 listener — 调用方收到所有 panel 的事件并自行按
   * panelId 过滤. 多 panel 场景下会有 N 个 listener, 每个 panel 自行 dispose.
   */
  onCwdChange(cb: (event: TerminalCwdEvent) => void): () => void;
  onDebugRendererSnapshotRequest: (
    cb: (
      req: TerminalDebugRendererSnapshotRequest
    ) => Promise<TerminalDebugRendererSnapshot> | TerminalDebugRendererSnapshot
  ) => () => void;
  /** native terminal 内容区收到左键聚焦意图时, 通知 renderer 激活对应 dockview tab. */
  onFocusRequest: (cb: (req: TerminalFocusRequest) => void) => () => void;
  /**
   * 订阅 terminal title (OSC 0/2) 变化. 回调返回 dispose 函数.
   * 与 onCwdChange 相同的"多 listener 各自过滤"模式.
   */
  onTitleChange(cb: (event: TerminalTitleEvent) => void): () => void;
  openDebugWindow(): Promise<TerminalDebugWindowOpenResult>;
  performOperation(
    panelId: string,
    operation: TerminalOperation
  ): Promise<TerminalOperationResult>;
  /**
   * 读取上次关闭前的 terminal panel 展示状态. 用于 app 重启后先恢复 tab
   * 标题/cwd, 真正的 native terminal 可以等 panel 可见时再创建.
   */
  readSession(panelId: string): Promise<TerminalPanelSessionSnapshot | null>;
  /**
   * 报告 renderer 当前活跃的 terminal panelId 集合. swift 把不在集合里的 NSView
   * 清掉 — C 方案 reload 零销毁路径的孤儿兜底:reload 前 layout 有但新 layout
   * 没有的 panel 在这里被回收. dockview restore 完成时 (renderer 知道完整 layout)
   * 调一次即可. fire-and-forget.
   */
  reconcile(activeIds: string[]): void;
  setActivePanelKind: (
    kind: "terminal" | "web",
    panelId: string | null
  ) => void;
  setAppShortcutKeys(keys: string[]): void;
  setConfig(config: TerminalRuntimeConfig): void;
  /**
   * 热更新已存在 terminal 的字体. 走 Ghostty TerminalController.setTerminalConfiguration
   * → ghostty_surface_update_config, 不重建 surface, 不杀 shell. fire-and-forget.
   */
  setFont(panelId: string, font: TerminalFont): void;
  setFrame(panelId: string, frame: TerminalFrame): void;
  setOverlayActive(active: boolean): void;
  setup(): Promise<CreateTerminalResult>;
  show(panelId: string): void;
}
