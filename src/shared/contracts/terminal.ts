export interface TerminalFrame {
  height: number;
  width: number;
  x: number;
  y: number;
}

export interface CreateTerminalArgs {
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
 * cursor / selectionBackground 写成 `| undefined` 而非纯 optional, 是因为项目
 * tsconfig 启用 exactOptionalPropertyTypes — derive 函数会显式赋 undefined 表示
 * "主题缺这个键", IPC 边界用 isString 守卫区分缺失 vs 实际值.
 */
export interface TerminalColors {
  background: string;
  cursor?: string | undefined;
  foreground: string;
  palette: AnsiPalette;
  selectionBackground?: string | undefined;
}

export interface TerminalAPI {
  applyTheme(colors: TerminalColors): void;
  close(panelId: string): Promise<void>;
  create(args: CreateTerminalArgs): Promise<CreateTerminalResult>;
  focus(panelId: string): void;
  hide(panelId: string): void;
  /** 订阅 swift 转发的右键事件. 返回 unsubscribe. */
  onContextMenuRequest: (
    cb: (req: TerminalContextMenuRequest) => void
  ) => () => void;
  setActivePanelKind: (
    kind: "terminal" | "web",
    panelId: string | null
  ) => void;
  setFrame(panelId: string, frame: TerminalFrame): void;
  setOverlayActive(active: boolean): void;
  setup(): Promise<CreateTerminalResult>;
  show(panelId: string): void;
}
