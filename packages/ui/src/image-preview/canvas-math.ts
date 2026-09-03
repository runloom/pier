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
/**
 * Extra bottom viewport inset clearing the floating zoom controls pill
 * (pb-4 + 28px buttons + shadow), so fit and resting scroll positions never
 * leave content under the controls. Matches `pb-16` on the viewport section.
 */
export const VIEWPORT_CONTROLS_INSET_PX = 64;
/** Content-preview header band (`h-14`). Fit insets keep content out of it. */
export const VIEWPORT_CHROME_TOP_PX = 56;

/** Per-side insets used when fitting a world camera into a viewport. */
export interface ViewportFitInsets {
  bottom: number;
  left: number;
  right: number;
  top: number;
}

export function uniformFitInsets(
  totalBothSides: number = VIEWPORT_PADDING_PX
): ViewportFitInsets {
  const side = totalBothSides / 2;
  return { bottom: side, left: side, right: side, top: side };
}

/** Fullscreen overlay: float title above the paper; clear the zoom pill. */
export const WORLD_OVERLAY_FIT_INSETS: ViewportFitInsets = {
  bottom: VIEWPORT_CONTROLS_INSET_PX,
  left: VIEWPORT_PADDING_PX / 2,
  right: VIEWPORT_PADDING_PX / 2,
  top: VIEWPORT_CHROME_TOP_PX,
};

/** Files board preview: no overlay title; still clear the zoom pill. */
export const WORLD_BOARD_FIT_INSETS: ViewportFitInsets = {
  bottom: VIEWPORT_CONTROLS_INSET_PX,
  left: VIEWPORT_PADDING_PX / 2,
  right: VIEWPORT_PADDING_PX / 2,
  top: VIEWPORT_PADDING_PX / 2,
};

/** Overlay keeps the floating title band; board is a file-tab / panel stage. */
export type ImagePreviewChrome = "overlay" | "board";

export function imagePreviewFitInsets(
  chrome: ImagePreviewChrome
): ViewportFitInsets {
  return chrome === "overlay"
    ? WORLD_OVERLAY_FIT_INSETS
    : WORLD_BOARD_FIT_INSETS;
}

/** Total vertical padding consumed by `measureContainScale` / CSS fit. */
export function fitInsetsPadY(insets: ViewportFitInsets): number {
  return insets.top + insets.bottom;
}

export interface FitCameraOptions {
  allowUpscale?: boolean | undefined;
  padding?: number | ViewportFitInsets | undefined;
}

/** Trackpad pinch (ctrl+wheel) exponent per deltaY unit. */
export const PINCH_ZOOM_SENSITIVITY = 0.01;

export function clampZoom(value: number): number {
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, Number(value.toFixed(4))));
}

/** Smooth pinch step: multiplicative, sign of deltaY picks the direction. */
export function pinchZoom(base: number, deltaY: number): number {
  return clampZoom(base * Math.exp(-deltaY * PINCH_ZOOM_SENSITIVITY));
}

/** Contain scale. Default matches object-contain (no upscale). */
export function measureContainScale(args: {
  /**
   * When true, small content may scale above 1 to fill the padded viewport
   * (diagram / board fit). Photos keep the default `false`.
   */
  allowUpscale?: boolean | undefined;
  naturalHeight: number;
  naturalWidth: number;
  /** Total padding subtracted per axis (both sides). Default VIEWPORT_PADDING_PX. */
  paddingPx?: number;
  /**
   * Vertical override when the viewport reserves a bottom controls band
   * (top padding + VIEWPORT_CONTROLS_INSET_PX). Horizontal stays paddingPx.
   */
  paddingYPx?: number;
  viewportHeight: number;
  viewportWidth: number;
}): number {
  const padX = args.paddingPx ?? VIEWPORT_PADDING_PX;
  const padY = args.paddingYPx ?? args.paddingPx ?? VIEWPORT_PADDING_PX;
  if (args.naturalWidth <= 0 || args.naturalHeight <= 0) return 1;
  const availW = Math.max(1, args.viewportWidth - padX);
  const availH = Math.max(1, args.viewportHeight - padY);
  const ratio = Math.min(
    availW / args.naturalWidth,
    availH / args.naturalHeight
  );
  return clampZoom(args.allowUpscale ? ratio : Math.min(ratio, 1));
}

/**
 * Keep a viewport content point stable across a CSS zoom change.
 * Anchor is viewport-relative px (pointer position); defaults to the center
 * so button / keyboard zoom keeps today's behavior.
 */
export function anchoredScrollAfterZoom(args: {
  anchorX?: number;
  anchorY?: number;
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
  const anchorX = args.anchorX ?? args.clientWidth / 2;
  const anchorY = args.anchorY ?? args.clientHeight / 2;
  const ratio = args.newZoom / args.oldZoom;
  return {
    scrollLeft: Math.max(0, (args.scrollLeft + anchorX) * ratio - anchorX),
    scrollTop: Math.max(0, (args.scrollTop + anchorY) * ratio - anchorY),
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

/**
 * World camera for canvas board shells: one transform, no scroll clamping.
 * screen = world × scale + (x, y).
 */
export interface WorldCamera {
  scale: number;
  x: number;
  y: number;
}

export interface WorldSizeBox {
  height: number;
  width: number;
  x?: number;
  y?: number;
}

/** Soft camera constraint: keep at least this much content in the viewport. */
export const CAMERA_KEEP_VISIBLE_PX = 64;

/** Translate a viewport screen point to a world-space point. */
export function screenToWorldPoint(
  point: { x: number; y: number },
  camera: WorldCamera
): { x: number; y: number } {
  return {
    x: (point.x - camera.x) / camera.scale,
    y: (point.y - camera.y) / camera.scale,
  };
}

/** Translate a world-space point to a viewport screen point. */
export function worldToScreenPoint(
  point: { x: number; y: number },
  camera: WorldCamera
): { x: number; y: number } {
  return {
    x: point.x * camera.scale + camera.x,
    y: point.y * camera.scale + camera.y,
  };
}

/** Persistable free pose: world point under the viewport center + scale. */
export interface WorldCameraLookAt {
  scale: number;
  worldX: number;
  worldY: number;
}

/** World point currently under the viewport center. */
export function worldPointAtViewportCenter(
  camera: WorldCamera,
  viewport: WorldSizeBox
): { x: number; y: number } {
  return screenToWorldPoint(
    { x: viewport.width / 2, y: viewport.height / 2 },
    camera
  );
}

/** Camera whose viewport center sits on `worldX/worldY` at `scale`. */
export function cameraLookingAtWorld(
  lookAt: WorldCameraLookAt,
  viewport: WorldSizeBox
): WorldCamera {
  const scale = clampZoom(lookAt.scale);
  return {
    scale,
    x: viewport.width / 2 - lookAt.worldX * scale,
    y: viewport.height / 2 - lookAt.worldY * scale,
  };
}

function resolveFitCameraOptions(
  options: number | FitCameraOptions | undefined
): { allowUpscale: boolean; insets: ViewportFitInsets } {
  if (typeof options === "number") {
    return { allowUpscale: false, insets: uniformFitInsets(options) };
  }
  const padding = options?.padding ?? VIEWPORT_PADDING_PX;
  return {
    allowUpscale: options?.allowUpscale === true,
    insets: typeof padding === "number" ? uniformFitInsets(padding) : padding,
  };
}

/**
 * Fit pose: contain scale, content centered in the padded viewport.
 * A numeric third argument is total padding on each axis (legacy).
 */
export function fitCamera(
  content: WorldSizeBox,
  viewport: WorldSizeBox,
  options: number | FitCameraOptions = VIEWPORT_PADDING_PX
): WorldCamera {
  const { allowUpscale, insets } = resolveFitCameraOptions(options);
  const padX = insets.left + insets.right;
  const padY = insets.top + insets.bottom;
  const scale = measureContainScale({
    allowUpscale,
    naturalHeight: content.height,
    naturalWidth: content.width,
    paddingPx: padX,
    paddingYPx: padY,
    viewportHeight: viewport.height,
    viewportWidth: viewport.width,
  });
  const originX = content.x ?? 0;
  const originY = content.y ?? 0;
  const availW = Math.max(1, viewport.width - padX);
  const availH = Math.max(1, viewport.height - padY);
  return {
    scale,
    x: insets.left + (availW - content.width * scale) / 2 - originX * scale,
    y: insets.top + (availH - content.height * scale) / 2 - originY * scale,
  };
}

/**
 * Rescale around a viewport point so the world point under the cursor stays
 * put. Exact — no scroll bounds to break the anchor.
 */
export function zoomCameraAt(
  camera: WorldCamera,
  point: { x: number; y: number },
  nextScale: number
): WorldCamera {
  const scale = clampZoom(nextScale);
  const worldX = (point.x - camera.x) / camera.scale;
  const worldY = (point.y - camera.y) / camera.scale;
  return {
    scale,
    x: point.x - worldX * scale,
    y: point.y - worldY * scale,
  };
}

/**
 * Soft constraint after pan/zoom: the content envelope must keep at least
 * `keepPx` visible inside the viewport (so a board cannot be flung away),
 * but the camera is otherwise free — unlike scroll, edges do not clamp.
 */
export function softClampCamera(
  camera: WorldCamera,
  content: WorldSizeBox,
  viewport: WorldSizeBox,
  keepPx: number = CAMERA_KEEP_VISIBLE_PX
): WorldCamera {
  const originX = content.x ?? 0;
  const originY = content.y ?? 0;
  const width = content.width * camera.scale;
  const height = content.height * camera.scale;
  const contentLeft = originX * camera.scale + camera.x;
  const contentTop = originY * camera.scale + camera.y;
  const keepX = Math.min(keepPx, width, viewport.width);
  const keepY = Math.min(keepPx, height, viewport.height);
  const clampedScreenLeft = Math.min(
    viewport.width - keepX,
    Math.max(keepX - width, contentLeft)
  );
  const clampedScreenTop = Math.min(
    viewport.height - keepY,
    Math.max(keepY - height, contentTop)
  );
  return {
    scale: camera.scale,
    x: clampedScreenLeft - originX * camera.scale,
    y: clampedScreenTop - originY * camera.scale,
  };
}

/** Measure the bounding rectangle of world-plane content elements. */
export function measureWorldContentBounds(
  root: HTMLElement
): WorldSizeBox | null {
  const stage =
    root.querySelector<HTMLElement>("[data-canvas-stage='world']") ?? root;
  const children = Array.from(stage.children).filter(
    (el): el is HTMLElement =>
      el instanceof HTMLElement && (el.offsetWidth > 0 || el.offsetHeight > 0)
  );
  if (children.length === 0) {
    const width = stage.offsetWidth || root.offsetWidth;
    const height = stage.offsetHeight || root.offsetHeight;
    return width > 0 && height > 0 ? { height, width, x: 0, y: 0 } : null;
  }

  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;

  for (const child of children) {
    const left = child.offsetLeft;
    const top = child.offsetTop;
    const width = child.offsetWidth;
    const height = child.offsetHeight;
    if (width > 0 && height > 0) {
      minX = Math.min(minX, left);
      minY = Math.min(minY, top);
      maxX = Math.max(maxX, left + width);
      maxY = Math.max(maxY, top + height);
    }
  }

  if (!(Number.isFinite(minX) && Number.isFinite(maxX))) {
    const width = stage.offsetWidth || root.offsetWidth;
    const height = stage.offsetHeight || root.offsetHeight;
    return width > 0 && height > 0 ? { height, width, x: 0, y: 0 } : null;
  }

  return {
    height: Math.max(1, maxY - minY),
    width: Math.max(1, maxX - minX),
    x: minX,
    y: minY,
  };
}

/** Check if an element is an input, editable area, or control that consumes keyboard events. */
export function isEditableOrControl(el: Element | null): boolean {
  if (!el) {
    return false;
  }
  return Boolean(
    el.tagName === "INPUT" ||
      el.tagName === "TEXTAREA" ||
      el.tagName === "SELECT" ||
      el.tagName === "BUTTON" ||
      el.hasAttribute("contenteditable") ||
      el.closest(
        "input, textarea, select, button, [contenteditable], [role='button'], [role='menuitem']"
      )
  );
}
