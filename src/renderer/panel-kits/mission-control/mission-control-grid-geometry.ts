import type { MissionControlGridSize } from "@shared/contracts/mission-control.ts";

/** 网格行高（px）。 */
export const ROW_HEIGHT = 88;

/** 网格间距（px）。[水平, 垂直]。 */
export const MARGIN: [number, number] = [12, 12];

/** 格子像素宽。与 ROW_HEIGHT 对齐成方格。 */
export const CELL_WIDTH = 88;

export interface SizeDeclaration {
  defaultSize?: MissionControlGridSize | undefined;
  maxSize?: MissionControlGridSize | undefined;
  minSize?: MissionControlGridSize | undefined;
}

/** clamp w/h ∈ [min, max] */
export function clampSize(
  size: MissionControlGridSize,
  min: MissionControlGridSize,
  max: MissionControlGridSize
): MissionControlGridSize {
  return {
    h: Math.max(min.h, Math.min(max.h, size.h)),
    w: Math.max(min.w, Math.min(max.w, size.w)),
  };
}
