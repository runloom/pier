/**
 * World-stage viewport state for the canvas preview shell.
 *
 * Detects the stage from the mounted root (see `canvas-stage.ts`) and drives
 * the inline world camera with the shared image-preview implementation
 * (`useWorldCamera` — single source, governance-locked). Plain wheel pans,
 * ctrl+wheel (trackpad pinch) zooms at the cursor — standard canvas
 * semantics, no focus gate (the world shell has no competing scroll target).
 */

import { measureWorldContentBounds } from "@pier/ui/image-preview/canvas-math.ts";
import type { ImagePreviewCanvasLabels } from "@pier/ui/image-preview/controls.tsx";
import { useWorldCamera } from "@pier/ui/image-preview/use-world-camera.ts";
import { INTERACTIVE_PAN_IGNORE } from "@pier/ui/image-preview/world-canvas.tsx";
import {
  type PointerEvent as ReactPointerEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { FilesTranslate } from "../i18n.ts";
import {
  type CanvasStageInfo,
  detectCanvasStage,
  FLOW_CANVAS_STAGE,
} from "./canvas-stage.ts";

export function useCanvasStageViewport(input: {
  canvasShellEl: HTMLDivElement | null;
  hostEl: HTMLDivElement | null;
  nonce: number;
  path: string;
  /** Design Mode pick is active — pan must not capture pointers then. */
  pickMode: boolean;
  stateKind: "error" | "loading" | "pending" | "ready";
  t: FilesTranslate;
}): {
  camera: ReturnType<typeof useWorldCamera>;
  stageInfo: CanvasStageInfo;
  stageLabels: ImagePreviewCanvasLabels;
  worldStage: boolean;
} {
  const { canvasShellEl, hostEl, nonce, path, pickMode, stateKind, t } = input;

  // Stage is a property of the composed root (WorldStage marker). Re-walk on
  // nonce (same host node can swap DocsShell ↔ WorldStage). Also observe the
  // host: live-module `createRoot().render()` is concurrent, so `ready` can
  // land before the composed marker is committed.
  const [stageInfo, setStageInfo] =
    useState<CanvasStageInfo>(FLOW_CANVAS_STAGE);
  // biome-ignore lint/correctness/useExhaustiveDependencies: nonce re-walks after hot-reload remounts even when the host node identity is stable
  useEffect(() => {
    if (!(hostEl && stateKind === "ready")) {
      return;
    }
    const apply = () => {
      const next = detectCanvasStage(hostEl);
      setStageInfo((current) =>
        current.docs === next.docs &&
        current.fill === next.fill &&
        current.stage === next.stage
          ? current
          : next
      );
    };
    apply();
    if (typeof MutationObserver === "undefined") {
      return;
    }
    const observer = new MutationObserver(apply);
    observer.observe(hostEl, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, [hostEl, nonce, stateKind]);
  const worldStage = stageInfo.stage === "world";

  const pickModeRef = useRef(false);
  useEffect(() => {
    pickModeRef.current = pickMode;
  }, [pickMode]);

  const shouldCaptureWorldPointer = useCallback(
    (event: ReactPointerEvent<HTMLElement>) => {
      if (pickModeRef.current) {
        return false;
      }
      const target = event.target;
      if (!(target instanceof Element)) {
        return true;
      }
      return !target.closest(INTERACTIVE_PAN_IGNORE);
    },
    []
  );
  const getWorldContentSize = useCallback(() => {
    if (!canvasShellEl) {
      return null;
    }
    return measureWorldContentBounds(canvasShellEl);
  }, [canvasShellEl]);
  const camera = useWorldCamera({
    enabled: worldStage,
    getContentSize: getWorldContentSize,
    resetKey: `${path}:${nonce}`,
    shouldCapturePointer: shouldCaptureWorldPointer,
  });

  // The world plane can grow after mount (WorldStage measures its Layers),
  // so re-fit on shell resize — mirror of ZoomPanWorldStage's world observer.
  useEffect(() => {
    if (
      !(worldStage && canvasShellEl) ||
      typeof ResizeObserver === "undefined"
    ) {
      return;
    }
    const observer = new ResizeObserver(() => {
      camera.measureFit();
    });
    observer.observe(canvasShellEl);
    return () => observer.disconnect();
  }, [worldStage, canvasShellEl, camera.measureFit]);

  // Zoom chrome is the shared ImagePreviewControls widget; copy is canvas
  // stage, not the image previewer. loadFailed/loading satisfy the labels
  // type and are not shown on this toolbar.
  const stageLabels = useMemo<ImagePreviewCanvasLabels>(
    () => ({
      actualSize: t("filePanel.canvas.stage.actualSize", "Actual size"),
      controlsLabel: t(
        "filePanel.canvas.stage.controlsLabel",
        "Board controls"
      ),
      fit: t("filePanel.canvas.stage.fit", "Fit to window"),
      loadFailedDescription: t(
        "filePanel.canvas.compileFailedHint",
        "Fix the canvas file or its imports, then reload."
      ),
      loadFailedTitle: t(
        "filePanel.canvas.compileFailed",
        "Couldn’t compile canvas"
      ),
      loading: t("filePanel.canvas.compiling", "Compiling canvas…"),
      viewerLabel: t("filePanel.canvas.stage.viewerLabel", "Board view"),
      zoomIn: t("filePanel.canvas.stage.zoomIn", "Zoom in"),
      zoomLevel: t("filePanel.canvas.stage.zoomLevel", "Zoom level"),
      zoomOut: t("filePanel.canvas.stage.zoomOut", "Zoom out"),
    }),
    [t]
  );

  return { camera, stageInfo, stageLabels, worldStage };
}
