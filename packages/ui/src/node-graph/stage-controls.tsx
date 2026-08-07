"use client";

import { useReactFlow, useStore } from "@xyflow/react";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  type ImagePreviewCanvasLabels,
  ImagePreviewControls,
} from "../image-preview/controls.tsx";
import { MIN_ZOOM, STAGE_FIT_VIEW_OPTIONS, STAGE_MAX_ZOOM } from "./model.ts";

export type NodeGraphStageControlLabels = Pick<
  ImagePreviewCanvasLabels,
  "actualSize" | "controlsLabel" | "fit" | "zoomIn" | "zoomLevel" | "zoomOut"
>;

const DEFAULT_LABELS: NodeGraphStageControlLabels = {
  actualSize: "Actual size",
  controlsLabel: "Graph controls",
  fit: "Fit to window",
  zoomIn: "Zoom in",
  zoomLevel: "Zoom level",
  zoomOut: "Zoom out",
};

/**
 * Bottom-center zoom chrome — same control strip as image / mermaid fullscreen.
 */
export function NodeGraphStageControls({
  labels: labelsProp,
}: {
  labels?: NodeGraphStageControlLabels | undefined;
}) {
  const labels = { ...DEFAULT_LABELS, ...labelsProp };
  const { fitView, getZoom, zoomIn, zoomOut, zoomTo } = useReactFlow();
  const storeZoom = useStore((state) => state.transform[2]);
  const [mode, setMode] = useState<number | "fit">("fit");
  const lastFitZoomRef = useRef<number | null>(null);
  const suppressFitExitRef = useRef(false);

  // Wheel / pinch: leave "fit" when transform diverges from last fit result.
  useEffect(() => {
    if (mode !== "fit" || suppressFitExitRef.current) {
      return;
    }
    const baseline = lastFitZoomRef.current;
    if (baseline === null) {
      lastFitZoomRef.current = storeZoom;
      return;
    }
    if (Math.abs(storeZoom - baseline) > 0.02) {
      setMode(storeZoom);
    }
  }, [mode, storeZoom]);

  const effectiveZoom = storeZoom;
  const zoom = mode === "fit" ? "fit" : mode;

  const onZoomIn = useCallback(() => {
    setMode(getZoom());
    zoomIn({ duration: 120 }).catch(() => undefined);
  }, [getZoom, zoomIn]);

  const onZoomOut = useCallback(() => {
    setMode(getZoom());
    zoomOut({ duration: 120 }).catch(() => undefined);
  }, [getZoom, zoomOut]);

  const onZoomChange = useCallback(
    (value: number | "fit") => {
      if (value === "fit") {
        suppressFitExitRef.current = true;
        setMode("fit");
        fitView(STAGE_FIT_VIEW_OPTIONS)
          .then(() => {
            requestAnimationFrame(() => {
              lastFitZoomRef.current = getZoom();
              suppressFitExitRef.current = false;
            });
          })
          .catch(() => {
            suppressFitExitRef.current = false;
          });
        return;
      }
      const next = Math.min(STAGE_MAX_ZOOM, Math.max(value, MIN_ZOOM));
      setMode(next);
      zoomTo(next, { duration: 120 }).catch(() => undefined);
    },
    [fitView, getZoom, zoomTo]
  );

  const controlLabels: ImagePreviewCanvasLabels = {
    actualSize: labels.actualSize,
    controlsLabel: labels.controlsLabel,
    fit: labels.fit,
    loadFailedDescription: "",
    loadFailedTitle: "",
    loading: "",
    viewerLabel: labels.controlsLabel,
    zoomIn: labels.zoomIn,
    zoomLevel: labels.zoomLevel,
    zoomOut: labels.zoomOut,
  };

  return (
    <ImagePreviewControls
      effectiveZoom={effectiveZoom}
      labels={controlLabels}
      maxZoom={STAGE_MAX_ZOOM}
      minZoom={MIN_ZOOM}
      onZoomChange={onZoomChange}
      onZoomIn={onZoomIn}
      onZoomOut={onZoomOut}
      zoom={zoom}
    />
  );
}
