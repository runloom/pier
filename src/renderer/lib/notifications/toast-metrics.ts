/**
 * Toast 堆叠 / 双列避让的单一几何来源。
 *
 * Sonner 自己按 `gap` 与每条 toast 的高度算折叠偏移；这里只固定 Pier
 * 的堆叠深度、胶囊高度和两列在窄窗下的避让距离。CSS 中对应的
 * `--pier-toast-*` 变量由 sonner.tsx 注入，治理测试锁死数值。
 */
export const TOAST_STACK_DEPTH = 3;
export const TOAST_GAP_PX = 10;
export const TOAST_CAPSULE_HEIGHT_PX = 28;
export const TOAST_EDGE_INSET_PX = 24;
export const TOAST_CENTER_MAX_WIDTH_PX = 420;
export const TOAST_MESSAGE_MAX_WIDTH_PX = 360;
export const TOAST_LANE_GUTTER_PX = 16;

/** A 列展开态最大足迹（3 条 × 28 + 2 × 10）加与 B 列的垂直间距。 */
export const TOAST_LANE_CLEARANCE_PX =
  TOAST_STACK_DEPTH * TOAST_CAPSULE_HEIGHT_PX +
  (TOAST_STACK_DEPTH - 1) * TOAST_GAP_PX +
  TOAST_LANE_GUTTER_PX;

/**
 * A 列右缘（窗口中心 + 半个 A 列宽）与 B 列左缘（窗口右缘 - 24 - B 列宽）
 * 相碰时的窗口宽度；再留一个 gutter。窄于此值时 B 列整体下移。
 */
export const TOAST_LANE_COLLISION_MAX_WIDTH_PX =
  2 *
  (TOAST_CENTER_MAX_WIDTH_PX / 2 +
    TOAST_MESSAGE_MAX_WIDTH_PX +
    TOAST_EDGE_INSET_PX +
    TOAST_LANE_GUTTER_PX);
