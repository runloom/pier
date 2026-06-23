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

export interface TerminalAPI {
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
