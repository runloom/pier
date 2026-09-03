import type { CSSProperties } from "react";
import type { WorldCamera } from "./canvas-math.ts";

/** World-space dot grid (Figma / tldraw LOD): lock to the camera, keep screen density. */
export const WORLD_GRID_BASE_PX = 20;
export const WORLD_GRID_MIN_SCREEN_PX = 12;
export const WORLD_GRID_MAX_SCREEN_PX = 28;
export const WORLD_GRID_DOT_RADIUS_PX = 1.25;

const WORLD_GRID_LOD_LIMIT = WORLD_GRID_BASE_PX * 2 ** 8;

/**
 * Screen-pixel spacing for a world grid of `base` at `scale`, snapped so the
 * visible density stays in [min, max] by doubling/halving the world pitch.
 */
export function worldGridScreenSpacing(
  scale: number,
  base: number = WORLD_GRID_BASE_PX
): number {
  const safeScale = scale > 0 ? scale : 1;
  let world = base;
  let screen = world * safeScale;
  while (screen < WORLD_GRID_MIN_SCREEN_PX && world < WORLD_GRID_LOD_LIMIT) {
    world *= 2;
    screen = world * safeScale;
  }
  while (screen > WORLD_GRID_MAX_SCREEN_PX && world > base / 2 ** 8) {
    world /= 2;
    screen = world * safeScale;
  }
  return screen;
}

export function computeWorldDotGridStyle(camera: WorldCamera): CSSProperties {
  const spacing = worldGridScreenSpacing(camera.scale);
  const offsetX = ((camera.x % spacing) + spacing) % spacing;
  const offsetY = ((camera.y % spacing) + spacing) % spacing;
  return {
    backgroundImage: `radial-gradient(circle, var(--border) ${WORLD_GRID_DOT_RADIUS_PX}px, transparent ${WORLD_GRID_DOT_RADIUS_PX}px)`,
    backgroundPosition: `${offsetX}px ${offsetY}px`,
    backgroundSize: `${spacing}px ${spacing}px`,
  };
}
