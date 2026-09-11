interface ChipBox {
  readonly h: number;
  readonly id?: string;
  readonly w: number;
  readonly x: number;
  readonly y: number;
}

export const SCREEN_FLOW_START_CHIP_GAP = 8;
export const SCREEN_FLOW_START_CHIP_H = 24;
/** CSS padding-x 8 + border 1, both sides. */
export const SCREEN_FLOW_START_CHIP_PAD_X = 18;
const CAPTION_BAND = 40;

function rectsOverlap(
  a: { h: number; w: number; x: number; y: number },
  b: { h: number; w: number; x: number; y: number }
): boolean {
  return !(
    a.x + a.w <= b.x ||
    b.x + b.w <= a.x ||
    a.y + a.h <= b.y ||
    b.y + b.h <= a.y
  );
}

function rectsContain(
  outer: { h: number; w: number; x: number; y: number },
  inner: { h: number; w: number; x: number; y: number }
): boolean {
  return (
    outer.x <= inner.x &&
    outer.y <= inner.y &&
    outer.x + outer.w >= inner.x + inner.w &&
    outer.y + outer.h >= inner.y + inner.h
  );
}

export function screenFlowStartChipSize(title: string): {
  h: number;
  w: number;
} {
  return {
    h: SCREEN_FLOW_START_CHIP_H,
    w: Math.min(280, SCREEN_FLOW_START_CHIP_PAD_X + title.length * 12),
  };
}

/** Smallest Layer that wraps the start frame — ignore only that one. */
function startWrapper(
  layers: readonly ChipBox[],
  startFrame: ChipBox | undefined
): ChipBox | undefined {
  if (!startFrame) {
    return;
  }
  let best: ChipBox | undefined;
  let bestArea = Number.POSITIVE_INFINITY;
  for (const layer of layers) {
    if (!rectsContain(layer, startFrame)) {
      continue;
    }
    const area = layer.w * layer.h;
    if (area < bestArea) {
      best = layer;
      bestArea = area;
    }
  }
  return best;
}

/**
 * Title chip sits above the start caption, or beside it when that band is
 * taken. Beside is skipped when it would cover a neighbor frame or Layer.
 */
export function screenFlowStartChipPosition(input: {
  caption: ChipBox;
  frames: readonly ChipBox[];
  layers: readonly ChipBox[];
  startId: string;
  title: string;
}): { left: number; top: number } {
  const size = screenFlowStartChipSize(input.title);
  const above = {
    h: size.h,
    w: size.w,
    x: input.caption.x,
    y: input.caption.y - SCREEN_FLOW_START_CHIP_GAP - size.h,
  };
  const beside = {
    h: size.h,
    w: size.w,
    x: input.caption.x + input.caption.w + SCREEN_FLOW_START_CHIP_GAP,
    y: input.caption.y,
  };
  const startFrame = input.frames.find((box) => box.id === input.startId);
  const wrapper = startWrapper(input.layers, startFrame);
  const hits = (rect: {
    h: number;
    w: number;
    x: number;
    y: number;
  }): boolean => {
    const layerHit = input.layers.some((layer) => {
      if (
        wrapper &&
        layer.x === wrapper.x &&
        layer.y === wrapper.y &&
        layer.w === wrapper.w &&
        layer.h === wrapper.h
      ) {
        return false;
      }
      return rectsOverlap(layer, rect);
    });
    const frameHit = input.frames.some((frame) => {
      if (frame.id === input.startId) {
        return false;
      }
      const withCaption = {
        h: frame.h + CAPTION_BAND,
        w: frame.w,
        x: frame.x,
        y: frame.y - CAPTION_BAND,
      };
      return rectsOverlap(frame, rect) || rectsOverlap(withCaption, rect);
    });
    return layerHit || frameHit;
  };
  if (!hits(above)) {
    return { left: above.x, top: Math.max(0, above.y) };
  }
  if (!hits(beside)) {
    return { left: beside.x, top: beside.y };
  }
  return { left: above.x, top: Math.max(0, above.y) };
}
