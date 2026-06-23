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

export interface TerminalAPI {
  close(panelId: string): Promise<void>;
  create(args: CreateTerminalArgs): Promise<CreateTerminalResult>;
  focus(panelId: string): void;
  hide(panelId: string): void;
  /**
   * 订阅 terminal cwd 变化. 回调返回 dispose 函数, 调用即取消订阅.
   * 单个 listener 接收所有 panel 的事件 — 调用方按 panelId 自行过滤.
   */
  onCwdChange(cb: (event: TerminalCwdEvent) => void): () => void;
  /**
   * 订阅 terminal title (OSC 0/2) 变化. 回调返回 dispose 函数.
   * 单 listener 接所有 panel 事件 — 调用方按 panelId 过滤.
   */
  onTitleChange(cb: (event: TerminalTitleEvent) => void): () => void;
  setActivePanelKind: (
    kind: "terminal" | "web",
    panelId: string | null
  ) => void;
  setFrame(panelId: string, frame: TerminalFrame): void;
  setOverlayActive(active: boolean): void;
  setup(): Promise<CreateTerminalResult>;
  show(panelId: string): void;
}
