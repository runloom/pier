export const MIN_ZOOM = 0.1;
export const MAX_ZOOM = 8;
/** Multiplicative step (GNOME / Preview-style); additive % jumps feel uneven. */
export const ZOOM_FACTOR = 1.25;
export const PRESET_ZOOM_LEVELS = [0.25, 0.5, 1, 2, 4] as const;
/** Ignore sub-threshold moves so empty-click dismiss still works. */
export const PAN_CLICK_SLOP_PX = 4;
export const KEYBOARD_PAN_STEP_PX = 48;
/** Matches Tailwind `p-3` on the viewport (12px × 2). */
export const VIEWPORT_PADDING_PX = 24;

export function clampZoom(value: number): number {
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, Number(value.toFixed(4))));
}

/** Contain scale (no upscale), same as max-width/height 100% object-contain. */
export function measureContainScale(args: {
  naturalHeight: number;
  naturalWidth: number;
  paddingPx?: number;
  viewportHeight: number;
  viewportWidth: number;
}): number {
  const pad = args.paddingPx ?? VIEWPORT_PADDING_PX;
  if (args.naturalWidth <= 0 || args.naturalHeight <= 0) return 1;
  const availW = Math.max(1, args.viewportWidth - pad);
  const availH = Math.max(1, args.viewportHeight - pad);
  return clampZoom(
    Math.min(availW / args.naturalWidth, availH / args.naturalHeight, 1)
  );
}

/** Keep the viewport-center content point stable across a CSS zoom change. */
export function anchoredScrollAfterZoom(args: {
  clientHeight: number;
  clientWidth: number;
  newZoom: number;
  oldZoom: number;
  scrollLeft: number;
  scrollTop: number;
}): { scrollLeft: number; scrollTop: number } {
  if (!(args.oldZoom > 0 && args.newZoom > 0)) {
    return { scrollLeft: args.scrollLeft, scrollTop: args.scrollTop };
  }
  const ratio = args.newZoom / args.oldZoom;
  return {
    scrollLeft: Math.max(
      0,
      (args.scrollLeft + args.clientWidth / 2) * ratio - args.clientWidth / 2
    ),
    scrollTop: Math.max(
      0,
      (args.scrollTop + args.clientHeight / 2) * ratio - args.clientHeight / 2
    ),
  };
}

export function centeredScroll(args: {
  clientHeight: number;
  clientWidth: number;
  scrollHeight: number;
  scrollWidth: number;
}): { scrollLeft: number; scrollTop: number } {
  return {
    scrollLeft: Math.max(0, (args.scrollWidth - args.clientWidth) / 2),
    scrollTop: Math.max(0, (args.scrollHeight - args.clientHeight) / 2),
  };
}
