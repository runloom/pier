import type { PierImageDiffSide } from "./types.ts";

/** Max CSS edge for photos / large assets (matches max-h-96). */
export const IMAGE_DIFF_MAX_STAGE_PX = 384;
/** Assets at or below this edge are nearest-neighbor scaled for review. */
export const IMAGE_DIFF_PIXELATED_MAX_EDGE = 64;
/** Target CSS edge when upscaling pixel art / app icons. */
export const IMAGE_DIFF_PIXELATED_TARGET_PX = 192;

export interface ImageDiffBox {
  readonly height: number;
  readonly width: number;
}

/**
 * Shared CSS stage so 2-up / swipe / onion compare on one scale.
 * A 256×256 vs 512×512 pair uses a 512-based stage; the smaller image
 * renders at half size (GitHub 2-up dimension-change behavior).
 */
export interface ImageDiffStage {
  readonly after: ImageDiffBox | null;
  readonly before: ImageDiffBox | null;
  readonly height: number;
  readonly pixelated: boolean;
  readonly width: number;
}

export function imageDiffStage(
  before: PierImageDiffSide | null,
  after: PierImageDiffSide | null
): ImageDiffStage | null {
  const beforeBox = intrinsicBox(before);
  const afterBox = intrinsicBox(after);
  if (beforeBox === null && afterBox === null) {
    return null;
  }
  const maxWidth = Math.max(beforeBox?.width ?? 0, afterBox?.width ?? 0, 1);
  const maxHeight = Math.max(beforeBox?.height ?? 0, afterBox?.height ?? 0, 1);
  const pixelated =
    (beforeBox === null || isPixelatedBox(beforeBox)) &&
    (afterBox === null || isPixelatedBox(afterBox));
  const maxEdge = Math.max(maxWidth, maxHeight);
  const scale = pixelated
    ? Math.min(
        IMAGE_DIFF_MAX_STAGE_PX / maxEdge,
        Math.max(2, IMAGE_DIFF_PIXELATED_TARGET_PX / maxEdge)
      )
    : Math.min(1, IMAGE_DIFF_MAX_STAGE_PX / maxEdge);
  return {
    after: afterBox === null ? null : scaleBox(afterBox, scale),
    before: beforeBox === null ? null : scaleBox(beforeBox, scale),
    height: Math.max(1, Math.round(maxHeight * scale)),
    pixelated,
    width: Math.max(1, Math.round(maxWidth * scale)),
  };
}

function intrinsicBox(side: PierImageDiffSide | null): ImageDiffBox | null {
  if (side === null || side.width === null || side.height === null) {
    return null;
  }
  return { height: side.height, width: side.width };
}

function isPixelatedBox(box: ImageDiffBox): boolean {
  return (
    box.width <= IMAGE_DIFF_PIXELATED_MAX_EDGE &&
    box.height <= IMAGE_DIFF_PIXELATED_MAX_EDGE
  );
}

function scaleBox(box: ImageDiffBox, scale: number): ImageDiffBox {
  return {
    height: Math.max(1, Math.round(box.height * scale)),
    width: Math.max(1, Math.round(box.width * scale)),
  };
}
