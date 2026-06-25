import type { PierCommandPlacement } from "./commands.ts";

export interface TerminalFrame {
  height: number;
  width: number;
  x: number;
  y: number;
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

export interface CreateTerminalArgs {
  cwd?: string | undefined;
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
  cwd: string;
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
  cwd?: string | undefined;
  title?: string | undefined;
  updatedAt: string;
}

export interface TerminalRecentSessionSnapshot {
  closedAt: string;
  cwd: string;
  id: string;
  panelId: string;
  recordId: string;
  title?: string | undefined;
  windowAlive: boolean;
  windowId?: string | undefined;
}

export interface TerminalOpenSessionSnapshot {
  active?: boolean | undefined;
  cwd?: string | undefined;
  groupIndex: number;
  panelId: string;
  recordId: string;
  tabCount: number;
  tabIndex: number;
  title?: string | undefined;
  windowFocused?: boolean | undefined;
  windowId: string;
}

export interface TerminalListError {
  message: string;
  recordId?: string | undefined;
  windowId?: string | undefined;
}

export interface TerminalListSnapshot {
  errors: TerminalListError[];
  open: TerminalOpenSessionSnapshot[];
  recentClosed: TerminalRecentSessionSnapshot[];
}

export interface TerminalListSessionsArgs {
  windowId?: string | undefined;
}

export interface TerminalOpenSessionArgs {
  cwd?: string | undefined;
  focus?: boolean | undefined;
  placement?: PierCommandPlacement | undefined;
  windowId?: string | undefined;
}

export interface TerminalSessionCommandResult {
  error?: string | undefined;
  ok: boolean;
  panelId?: string | undefined;
  windowId?: string | undefined;
}

export interface TerminalFocusSessionArgs {
  focus?: boolean | undefined;
  panelId: string;
  windowId?: string | undefined;
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
  applyTheme(colors: TerminalColors): void;
  /**
   * 关闭 terminal panel 的 native NSView. fire-and-forget — swift 端 close 是同步
   * 调用, 调用方不需要 await. 调用 idempotent (panelId 不存在时 no-op).
   */
  close(panelId: string): void;
  create(args: CreateTerminalArgs): Promise<CreateTerminalResult>;
  focus(panelId: string): void;
  focusSession(
    args: TerminalFocusSessionArgs
  ): Promise<TerminalSessionCommandResult>;
  hide(panelId: string): void;
  listRecentSessions(): Promise<TerminalRecentSessionSnapshot[]>;
  listSessions(args?: TerminalListSessionsArgs): Promise<TerminalListSnapshot>;
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
  /** native terminal 内容区收到左键聚焦意图时, 通知 renderer 激活对应 dockview tab. */
  onFocusRequest: (cb: (req: TerminalFocusRequest) => void) => () => void;
  /**
   * 订阅 terminal title (OSC 0/2) 变化. 回调返回 dispose 函数.
   * 与 onCwdChange 相同的"多 listener 各自过滤"模式.
   */
  onTitleChange(cb: (event: TerminalTitleEvent) => void): () => void;
  openSession(
    args?: TerminalOpenSessionArgs
  ): Promise<TerminalSessionCommandResult>;
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
