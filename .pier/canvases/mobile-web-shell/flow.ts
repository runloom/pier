export const FRAME_W = 393;
export const PATH_H = 560;
export const CAPTION_H = 40;
export const H_GAP = 140;
export const V_GAP = 140;
export const ORIGIN = 40;
export const NOTE_Y = 40;
export const NOTE_H = 88;
export const PATH_Y0 = NOTE_Y + NOTE_H + 40;
export const KIT_W = 340;
export const KIT_H = 520;
export const APPENDIX_W = FRAME_W;
export const APPENDIX_H = 320;
export const APPENDIX_GAP = 120;
export const APPENDIX_COLS = 4;
export const APPENDIX_COL_GAP = 48;
export const APPENDIX_ROW_GAP = 56;

export function col(index: number): number {
  return ORIGIN + index * (FRAME_W + H_GAP);
}

export function pathRow(index: number): number {
  return PATH_Y0 + index * (CAPTION_H + PATH_H + V_GAP);
}

export function frameBox(
  id: string,
  column: number,
  rowIndex: number
): { h: number; id: string; w: number; x: number; y: number } {
  return {
    h: PATH_H,
    id,
    w: FRAME_W,
    x: col(column),
    y: pathRow(rowIndex) + CAPTION_H,
  };
}

export const NOTE_W = col(4) + FRAME_W - ORIGIN;
export const PATH_RIGHT = col(5);
export const APPENDIX_X = PATH_RIGHT + FRAME_W + APPENDIX_GAP;

export function appendixOrigin(index: number): { x: number; y: number } {
  const column = index % APPENDIX_COLS;
  const rowIndex = Math.floor(index / APPENDIX_COLS);
  return {
    x: APPENDIX_X + column * (APPENDIX_W + APPENDIX_COL_GAP),
    y: PATH_Y0 + rowIndex * (CAPTION_H + APPENDIX_H + APPENDIX_ROW_GAP),
  };
}

export function kitOrigin(index: number): { x: number; y: number } {
  const p0Bottom = pathRow(0) + CAPTION_H + PATH_H;
  return {
    x: PATH_RIGHT,
    y: p0Bottom + 24 + index * (CAPTION_H + KIT_H + 24),
  };
}

export const mobileWebShellFrameBoxes = [
  frameBox("hosts", 0, 0),
  frameBox("workbench", 1, 0),
  frameBox("session", 2, 0),
  frameBox("changes", 3, 0),
  frameBox("diff", 4, 0),
  frameBox("pair", 0, 1),
  frameBox("inbox", 1, 1),
  frameBox("files", 3, 1),
  frameBox("preview", 4, 1),
  frameBox("pairCamera", 0, 2),
  frameBox("sessionEnded", 1, 2),
  frameBox("disconnected", 2, 2),
] as const;

export const mobileWebShellFlowSpec = {
  edges: [
    { from: "hosts", id: "e-enter", label: "进入", to: "workbench" },
    { from: "workbench", id: "e-session", label: "打开会话", to: "session" },
    { from: "session", id: "e-changes", label: "变更", to: "changes" },
    { from: "changes", id: "e-diff", label: "点文件", to: "diff" },
    {
      from: "hosts",
      id: "e-scan",
      label: "添加电脑",
      role: "branch" as const,
      to: "pair",
    },
    {
      from: "pair",
      id: "e-paired",
      label: "完成",
      role: "return" as const,
      to: "hosts",
    },
    {
      from: "workbench",
      id: "e-bell",
      label: "查看通知",
      role: "branch" as const,
      to: "inbox",
    },
    {
      from: "inbox",
      id: "e-notice",
      label: "点通知",
      role: "branch" as const,
      to: "session",
    },
    {
      from: "session",
      id: "e-files",
      label: "文件",
      role: "branch" as const,
      to: "files",
    },
    {
      from: "files",
      id: "e-open",
      label: "打开",
      role: "branch" as const,
      to: "preview",
    },
    {
      from: "pair",
      id: "e-no-cam",
      label: "相机不可用",
      role: "error" as const,
      to: "pairCamera",
    },
    {
      from: "pairCamera",
      id: "e-retry-cam",
      label: "重新扫码",
      role: "return" as const,
      to: "pair",
    },
    {
      from: "session",
      id: "e-drop",
      label: "断线",
      role: "error" as const,
      to: "disconnected",
    },
    {
      from: "disconnected",
      id: "e-retry",
      label: "连接恢复",
      role: "return" as const,
      to: "session",
    },
    {
      from: "inbox",
      id: "e-ended",
      label: "已关闭",
      role: "error" as const,
      to: "sessionEnded",
    },
    {
      from: "sessionEnded",
      id: "e-ended-back",
      label: "返回收件箱",
      role: "return" as const,
      to: "inbox",
    },
  ],
  mainPath: ["hosts", "workbench", "session", "changes", "diff"],
  start: "hosts",
  title: "先选电脑，再投影",
};
