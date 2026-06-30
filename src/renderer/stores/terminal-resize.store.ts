import { create } from "zustand";

interface TerminalResizeState {
  /**
   * reconciler 最近一次下发给 native 的 presentation snapshot 的 rendererSequence。
   * coordinator 用它与 native 的「就位」ack 对比，精确判断 resize 撤占位时机。
   */
  lastDownlinkSequence: number;
  /**
   * web 占位是否显示。resize 期间为 true，用终端背景色占位顶替 native 终端区域，
   * resize 结束、native 应用最终几何的 ack 到达后转回 false。terminal-panel 读取。
   */
  placeholderVisible: boolean;
  /**
   * 是否强制隐藏所有 native 终端（presentation visible=false + frame=null）。resize
   * 期间为 true，让 native 终端隐身、由 web 占位顶替。reconciler 读取此字段。
   *
   * 与 placeholderVisible 分开：resize 结束先把它转 false（终端在占位之后恢复最终位置），
   * 再等 native 就位 ack 撤占位，避免接缝闪烁。
   */
  suppressTerminals: boolean;
}

export const useTerminalResizeStore = create<TerminalResizeState>(() => ({
  lastDownlinkSequence: 0,
  placeholderVisible: false,
  suppressTerminals: false,
}));
