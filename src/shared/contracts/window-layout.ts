export interface WindowLayoutPulse {
  reason: "resize" | "view-zoom" | "zoom";
  windowZoomLevel?: number;
}
