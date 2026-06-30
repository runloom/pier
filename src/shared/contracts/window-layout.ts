export interface WindowLayoutPulse {
  /**
   * resize 生命周期阶段，仅 reason="resize" 时下发：
   * - "active": 拖拽进行中（连续触发）——此时用 web 占位顶替 native 终端
   * - "end": 拖拽结束 settle——终端恢复到最终位置、撤除占位
   * 用于让 native 终端与 web UI 在 resize 全程几何零错位。
   */
  phase?: "active" | "end";
  reason: "resize" | "view-zoom" | "zoom";
  windowZoomLevel?: number;
}
