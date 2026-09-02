/**
 * @vitest-environment jsdom
 */
import {
  cameraLookingAtWorld,
  fitCamera,
  type WorldCameraLookAt,
  worldPointAtViewportCenter,
} from "@pier/ui/image-preview/canvas-math.ts";
import { useWorldCamera } from "@pier/ui/image-preview/use-world-camera.ts";
import { renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";

const VIEWPORT = { height: 400, width: 800 };
const CONTENT = { height: 400, width: 800 };

function getTestContentSize() {
  return CONTENT;
}

function attachViewport(
  viewportRef: { current: HTMLElement | null },
  size = VIEWPORT
): void {
  if (viewportRef.current) {
    return;
  }
  const element = document.createElement("div");
  Object.defineProperty(element, "clientWidth", { value: size.width });
  Object.defineProperty(element, "clientHeight", { value: size.height });
  viewportRef.current = element;
}

function useWorldCameraForTest(input: {
  enabled?: boolean;
  recall?: () => WorldCameraLookAt | null;
  resetKey?: string;
}) {
  const camera = useWorldCamera({
    enabled: input.enabled ?? true,
    getContentSize: getTestContentSize,
    recall: input.recall,
    resetKey: input.resetKey,
  });
  attachViewport(camera.viewportRef);
  return camera;
}

describe("useWorldCamera recall", () => {
  const lookAt = { scale: 1.25, worldX: 48, worldY: -20 };

  it("restores a free look-at instead of snapping to fit", () => {
    const { result } = renderHook(() =>
      useWorldCameraForTest({
        recall: () => lookAt,
        resetKey: "board.canvas.tsx",
      })
    );
    const expected = cameraLookingAtWorld(lookAt, VIEWPORT);
    expect(result.current.zoom).not.toBe("fit");
    expect(result.current.camera).toEqual(expected);
    expect(result.current.lookAt).toEqual(lookAt);
    expect(result.current.effectiveZoom).toBe(1.25);
    const center = worldPointAtViewportCenter(
      result.current.camera ?? expected,
      VIEWPORT
    );
    expect(center.x).toBeCloseTo(lookAt.worldX);
    expect(center.y).toBeCloseTo(lookAt.worldY);
  });

  it("does not re-fit when the same world is re-enabled", () => {
    const held = { scale: 2, worldX: 10, worldY: 8 };
    const { result, rerender } = renderHook(
      ({ enabled }) =>
        useWorldCameraForTest({
          enabled,
          recall: () => held,
          resetKey: "board.canvas.tsx",
        }),
      { initialProps: { enabled: true } }
    );
    const expected = cameraLookingAtWorld(held, VIEWPORT);
    expect(result.current.camera).toEqual(expected);
    rerender({ enabled: false });
    rerender({ enabled: true });
    expect(result.current.camera).toEqual(expected);
    expect(result.current.zoom).not.toBe("fit");
  });

  it("drops the previous pose when the world identity changes without a recall", () => {
    const held = { scale: 2, worldX: 10, worldY: 8 };
    const { result, rerender } = renderHook(
      ({
        recall,
        resetKey,
      }: {
        recall: () => WorldCameraLookAt | null;
        resetKey: string;
      }) =>
        useWorldCameraForTest({
          recall,
          resetKey,
        }),
      {
        initialProps: {
          recall: (): WorldCameraLookAt | null => held,
          resetKey: "board-a.canvas.tsx",
        },
      }
    );
    expect(result.current.camera).toEqual(cameraLookingAtWorld(held, VIEWPORT));
    rerender({
      recall: () => null,
      resetKey: "board-b.canvas.tsx",
    });
    expect(result.current.zoom).toBe("fit");
    expect(result.current.lookAt).toBeNull();
    expect(result.current.camera).toEqual(fitCamera(CONTENT, VIEWPORT));
  });
});
