import type { PointerEvent as ReactPointerEvent } from "react";
import {
  cameraLookingAtWorld,
  clampZoom,
  softClampCamera,
  type WorldCamera,
  type WorldCameraLookAt,
  type WorldSizeBox,
  worldPointAtViewportCenter,
} from "./canvas-math.ts";

export interface WorldCameraHookInput {
  enabled?: boolean | undefined;
  getContentSize: () => WorldSizeBox | null;
  /** Restore a free look-at for this world (null / omitted → fit). */
  recall?: (() => WorldCameraLookAt | null) | undefined;
  resetKey?: string | number | null | undefined;
  shouldCapturePointer?:
    | ((event: ReactPointerEvent<HTMLElement>) => boolean)
    | undefined;
}

export function sameWorldCamera(
  current: WorldCamera | null,
  next: WorldCamera
): WorldCamera {
  return current &&
    current.scale === next.scale &&
    current.x === next.x &&
    current.y === next.y
    ? current
    : next;
}

export interface CameraPanSession {
  fromEmpty: boolean;
  moved: boolean;
  originX: number;
  originY: number;
  pointerId: number;
  startX: number;
  startY: number;
}

export function recalledFreeLookAt(
  recalled: WorldCameraLookAt | null | undefined
): WorldCameraLookAt | null {
  if (
    !(
      recalled &&
      Number.isFinite(recalled.worldX) &&
      Number.isFinite(recalled.worldY) &&
      Number.isFinite(recalled.scale) &&
      recalled.scale > 0
    )
  ) {
    return null;
  }
  return {
    scale: clampZoom(recalled.scale),
    worldX: recalled.worldX,
    worldY: recalled.worldY,
  };
}

export function stampWorldCameraLookAt(
  camera: WorldCamera,
  viewport: WorldSizeBox | null,
  lookAtRef: { current: WorldCameraLookAt | null }
): void {
  if (!viewport) {
    return;
  }
  const center = worldPointAtViewportCenter(camera, viewport);
  lookAtRef.current = {
    scale: camera.scale,
    worldX: center.x,
    worldY: center.y,
  };
}

export function lookAtFromCamera(
  camera: WorldCamera | null,
  mode: "fit" | "free",
  viewport: WorldSizeBox | null
): WorldCameraLookAt | null {
  if (!(mode === "free" && camera && viewport)) {
    return null;
  }
  const center = worldPointAtViewportCenter(camera, viewport);
  return {
    scale: camera.scale,
    worldX: center.x,
    worldY: center.y,
  };
}

function isMeasurable(
  content: WorldSizeBox | null,
  viewport: WorldSizeBox | null
): boolean {
  return Boolean(
    content &&
      viewport &&
      content.width > 0 &&
      content.height > 0 &&
      viewport.width > 0 &&
      viewport.height > 0
  );
}

function cameraFromLookAt(
  lookAt: WorldCameraLookAt,
  content: WorldSizeBox | null,
  viewport: WorldSizeBox
): WorldCamera {
  const pose = cameraLookingAtWorld(lookAt, viewport);
  return content ? softClampCamera(pose, content, viewport) : pose;
}

export type WorldCameraResetResult = "applied" | "cleared" | "wait";

/** Apply a recalled look-at, or fit. `wait` = look-at exists but viewport is not ready. */
export function applyWorldCameraReset(input: {
  getContentSize: () => WorldSizeBox | null;
  lookAtRef: { current: WorldCameraLookAt | null };
  measureFit: (force?: boolean) => void;
  modeRef: { current: "fit" | "free" };
  recall: (() => WorldCameraLookAt | null) | undefined;
  setCamera: (camera: WorldCamera) => void;
  setMode: (mode: "fit" | "free") => void;
  viewportBox: () => WorldSizeBox | null;
}): WorldCameraResetResult {
  const lookAt = recalledFreeLookAt(input.recall?.() ?? null);
  const content = input.getContentSize();
  const viewport = input.viewportBox();
  if (lookAt) {
    if (!viewport || viewport.width <= 0 || viewport.height <= 0) {
      return "wait";
    }
    input.setMode("free");
    input.modeRef.current = "free";
    const next = cameraFromLookAt(lookAt, content, viewport);
    input.setCamera(next);
    stampWorldCameraLookAt(next, viewport, input.lookAtRef);
    return "applied";
  }
  input.setMode("fit");
  input.modeRef.current = "fit";
  input.lookAtRef.current = null;
  if (!isMeasurable(content, viewport)) {
    return "cleared";
  }
  input.measureFit(true);
  return "applied";
}

export function applyWorldCameraViewportResize(input: {
  getContentSize: () => WorldSizeBox | null;
  lookAtRef: { current: WorldCameraLookAt | null };
  measureFit: (force?: boolean) => void;
  modeRef: { current: "fit" | "free" };
  setCamera: (camera: WorldCamera) => void;
  viewportBox: () => WorldSizeBox | null;
}): void {
  if (input.modeRef.current === "fit") {
    input.measureFit();
    return;
  }
  const lookAt = input.lookAtRef.current;
  const viewport = input.viewportBox();
  if (!(lookAt && viewport)) {
    return;
  }
  const next = cameraFromLookAt(lookAt, input.getContentSize(), viewport);
  input.setCamera(next);
  stampWorldCameraLookAt(next, viewport, input.lookAtRef);
}
