import type { AgentKind } from "./agent.ts";
import type { PanelContext, PanelTabChrome } from "./panel.ts";
import type { TaskOutputPanelParams, TaskPanelMetadata } from "./tasks.ts";
// TerminalAPI 是终端 IPC 契约, 里面 debugSnapshot / openDebugWindow 等 debug 相关
// 方法需要引用 debug schema. 仅 type-only 循环 import (tsc 会 erase), 不构成运行时环。
import type {
  TerminalDebugRendererSnapshot,
  TerminalDebugRendererSnapshotRequest,
  TerminalDebugSnapshot,
  TerminalDebugSnapshotArgs,
  TerminalDebugWindowOpenResult,
} from "./terminal-debug.ts";
import type { TerminalAgentRestoreLaunchOptions } from "./terminal-launch.ts";

export interface TerminalFrame {
  /** BrowserWindow contentView 坐标，top-left origin，已叠加 Electron page zoom。 */
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
  | "restore"
  | "visibility"
  | "window-blur"
  | "window-focus"
  | "window-resize"
  | `window-${"resize" | "view-zoom" | "zoom"}`;

export interface TerminalWebOverlayRect {
  frame: TerminalFrame;
  id: string;
}

export type TerminalKeyboardFocusTarget =
  | {
      kind: "terminal";
      panelId: string;
    }
  | {
      kind: "web";
    };

export interface TerminalHostEntry {
  frame: TerminalFrame | null;
  panelId: string;
  visible: boolean;
}

export type TerminalHostReason =
  | TerminalPresentationReason
  | "input-routing"
  | "surface-created"
  | "surface-closing";

export interface TerminalHostSnapshot {
  activePanelId: string | null;
  activeTerminalPanelId: string | null;
  basePanel: TerminalKeyboardFocusTarget;
  hasMaximizedGroup: boolean;
  reason: TerminalHostReason;
  rendererSequence: number;
  terminals: TerminalHostEntry[];
  webOverlayRects: TerminalWebOverlayRect[];
  webRequestCount: number;
}

export interface TerminalNativeWindowState {
  keyboardTarget: TerminalKeyboardFocusTarget;
  nativeApplySequence: number;
  reason: TerminalHostReason;
  rendererSequence: number;
  terminals: Array<TerminalHostEntry & { focused: boolean }>;
  webOverlayRects: TerminalWebOverlayRect[];
  windowFocused: boolean;
}

export type TerminalNativeApplyResult =
  | { status: "applied" | "stale" | "unchanged" }
  | { status: "error"; error: string };

export interface TerminalCoordinatorDebugSnapshot {
  desired: TerminalHostSnapshot | null;
  dirty: boolean;
  effective: TerminalNativeWindowState | null;
  lastError: string | null;
  lastSuccessfulNativeApplySequence: number;
  readyPanelIds: string[];
}

export interface TerminalFocusApplyResult {
  effective: TerminalNativeWindowState | null;
  error: string | null;
  nativeStatus: TerminalNativeApplyResult["status"] | null;
  rendererSequence: number | null;
  shouldAck: boolean;
  status:
    | "applied"
    | "conflict"
    | "error"
    | "stale"
    | "unavailable"
    | "unchanged";
  webContentsFocused: boolean;
}

export type NativeFocusIntentResult =
  | { ok: true; panelId: string }
  | {
      ok: false;
      reason: "cross-window" | "hidden" | "not-ready" | "stale";
    };

/**
 * Terminal 字体配置. family 是有序的字体族 fallback 链, 已在 renderer 侧由
 * computeMonoFontFamilyList 产出 (用户字体在前 + 真实字体名 fallback, 不含 CSS
 * generic). native 端逐项喂给 ghostty 的 font-family (每行一个、可重复), 而非拼成
 * 逗号串 —— ghostty 不吃逗号. size 单位 px, 是基础 monoFontSize 叠加整体界面缩放
 * 后的有效字号, 范围 8-48.
 */
export interface TerminalFont {
  /** 字体族 fallback 链 (有序)，已在 renderer 侧由 computeMonoFontFamilyList 产出，native 端逐项喂给 ghostty font-family。 */
  family: string[];
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
  initialInput?: string | undefined;
  launchId?: string | undefined;
  panelId: string;
  tab?: PanelTabChrome | undefined;
  task?: TaskPanelMetadata | undefined;
  /** 后台任务的只读 Ghostty 输出会话；存在时不创建 shell/PTY。 */
  taskOutput?: TaskOutputPanelParams | undefined;
}

export interface CreateTerminalResult {
  error?: string;
  ok: boolean;
}

export interface RebindTaskOutputResult extends CreateTerminalResult {
  generation?: number;
  stale?: boolean;
}

export interface TerminalAgentResumeMetadata {
  capturedAt: number;
  sessionId: string;
  source: "hook";
}

export interface TerminalAgentPanelMetadata {
  agentId: AgentKind;
  exitCode?: number | undefined;
  finishedAt?: number | undefined;
  launch: TerminalAgentRestoreLaunchOptions;
  resume?: TerminalAgentResumeMetadata | undefined;
  startedAt: number;
  status: "exited" | "running";
}

export interface TerminalContextMenuRequest {
  panelId: string;
  /** BrowserWindow contentView 坐标 (top-left origin, flipped). */
  x: number;
  y: number;
}

export interface TerminalFocusRequest {
  panelId: string;
  reason: "mouse-down" | "key-event" | "window-become-key" | "system";
}

/** Ghostty 的已退出 surface 收到用户按键后，请求关闭宿主 panel。 */
export interface TerminalSurfaceCloseRequest {
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
  agent?: TerminalAgentPanelMetadata | undefined;
  context?: PanelContext | undefined;
  tab?: PanelTabChrome | undefined;
  task?: TaskPanelMetadata | undefined;
  /**
   * main 担保的 task 活性：该 panel 的 task 面板寿命仍在本 main 进程内
   * （foreground-activity 有 task slot——running 或终态常驻）。true = renderer
   * reload 重挂路径（native 面保留, 渲染真终端）；false/缺席 = app restart,
   * 渲染静态结果卡。
   */
  taskLive?: boolean | undefined;
  title?: string | undefined;
  updatedAt: string;
}

export type TerminalOperation = "copy" | "paste" | "selectAll" | "clearScreen";

export interface TerminalOperationResult {
  error?: string | undefined;
  ok: boolean;
}

export type TerminalSelectionTextResult =
  | { kind: "empty" }
  | { kind: "error"; message: string }
  | { kind: "ok"; text: string };

export type TerminalSearchDirection = "next" | "previous";

export interface TerminalSearchStateEvent {
  panelId: string;
  selected: number;
  total: number;
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

export interface TerminalCloseOptions {
  reason?: "relaunch" | "workspace" | undefined;
}

export interface TerminalAPI {
  applyHostSnapshot(snapshot: TerminalHostSnapshot): void;
  applyTheme(colors: TerminalColors): void;
  /**
   * 关闭 terminal panel 的 native NSView. 普通 workspace close 可以忽略返回的
   * promise；同 panel relaunch 必须 await, 避免旧 close 删除新 session 状态.
   * 调用 idempotent (panelId 不存在时 no-op).
   */
  close(panelId: string, options?: TerminalCloseOptions): Promise<void>;
  create(args: CreateTerminalArgs): Promise<CreateTerminalResult>;
  debugSnapshot(
    args?: TerminalDebugSnapshotArgs
  ): Promise<TerminalDebugSnapshot>;
  endSearch(panelId: string): Promise<TerminalOperationResult>;
  navigateSearch(
    panelId: string,
    direction: TerminalSearchDirection
  ): Promise<TerminalOperationResult>;
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
  /** renderer 下发的 presentation 已被 native 同步应用, 用于 resize 撤占位的精确握手. */
  onPresentationApplied(
    cb: (payload: { rendererSequence: number }) => void
  ): () => void;
  /** main 端应用菜单请求打开当前终端搜索栏. */
  onSearchOpenRequest(cb: () => void): () => void;
  onSearchState(cb: (event: TerminalSearchStateEvent) => void): () => void;
  /** 用户在 Ghostty 的进程退出提示上按键后，关闭对应宿主 panel。 */
  onSurfaceCloseRequest: (
    cb: (req: TerminalSurfaceCloseRequest) => void
  ) => () => void;
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
  readSelectionText(panelId: string): Promise<TerminalSelectionTextResult>;
  /**
   * 读取上次关闭前的 terminal panel 展示状态. 用于 app 重启后先恢复 tab
   * 标题/cwd, 真正的 native terminal 可以等 panel 可见时再创建.
   */
  readSession(panelId: string): Promise<TerminalPanelSessionSnapshot | null>;
  /**
   * 在不更换 dockview panel 的前提下，把只读输出终端切换到另一 TaskRun。
   * generation 用于拒绝晚到的旧选择；失败时保留原绑定。
   */
  rebindTaskOutput(
    panelId: string,
    params: TaskOutputPanelParams
  ): Promise<RebindTaskOutputResult>;
  /**
   * 报告 renderer 当前活跃的 terminal panelId 集合. swift 把不在集合里的 NSView
   * 清掉 — C 方案 reload 零销毁路径的孤儿兜底:reload 前 layout 有但新 layout
   * 没有的 panel 在这里被回收. dockview restore 完成时 (renderer 知道完整 layout)
   * 调一次即可. fire-and-forget.
   */
  reconcile(activeIds: string[]): void;
  search(panelId: string, query: string): Promise<TerminalOperationResult>;
  setAppShortcutKeys(keys: string[]): void;
  setConfig(config: TerminalRuntimeConfig): void;
  /**
   * 热更新已存在 terminal 的字体. 走 Ghostty TerminalController.setTerminalConfiguration
   * → ghostty_surface_update_config, 不重建 surface, 不杀 shell. fire-and-forget.
   */
  setFont(panelId: string, font: TerminalFont): void;
  setup(): Promise<CreateTerminalResult>;
}
