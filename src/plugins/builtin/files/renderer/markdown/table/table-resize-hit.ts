import type { PointerEvent as ReactPointerEvent } from "react";

/** 竖分割线的拖拽命中带（分割线两侧各此像素）。 */
export const RESIZE_HIT_TOLERANCE_PX = 6;

/** 命中测试：指针是否落在某单元格右缘分割线的命中带内。 */
export function hitColumnBoundary(
  event: ReactPointerEvent<HTMLDivElement>
): { cell: HTMLTableCellElement; columnIndex: number } | null {
  const target = event.target;
  if (!(target instanceof Element)) return null;
  // 表头把手全域即命中：把手横跨边框两侧（right: -5px），抓外侧一半时
  // 指针已越过 th 右缘，几何带测试会漏掉它（表头"有时拖不动"的根因）。
  const handle = target.closest(".md-col-resizer");
  if (handle?.parentElement instanceof HTMLTableCellElement) {
    const th = handle.parentElement;
    if (th.cellIndex >= 0) return { cell: th, columnIndex: th.cellIndex };
  }
  const cell = target.closest("td, th");
  if (!(cell instanceof HTMLTableCellElement)) return null;
  const columnIndex = cell.cellIndex;
  if (columnIndex < 0) return null;
  const rect = cell.getBoundingClientRect();
  const fromRight = rect.right - event.clientX;
  if (fromRight >= 0 && fromRight <= RESIZE_HIT_TOLERANCE_PX) {
    return { cell, columnIndex };
  }
  // 左缘命中带（非首列）：分割线归属前一列的右缘，使命中带对边框对称。
  const fromLeft = event.clientX - rect.left;
  if (columnIndex > 0 && fromLeft >= 0 && fromLeft <= RESIZE_HIT_TOLERANCE_PX) {
    const prev = cell.previousElementSibling;
    if (prev instanceof HTMLTableCellElement && prev.cellIndex >= 0) {
      return { cell: prev, columnIndex: prev.cellIndex };
    }
  }
  return null;
}
