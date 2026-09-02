import { ImagePreviewControls } from "@pier/ui/image-preview/controls.tsx";
import type { MarkdownPreviewZoomLabels } from "./preview-defaults.ts";
import {
  cycleMarkdownFontScale,
  MARKDOWN_FONT_SCALES,
  type MarkdownFontScale,
} from "./preview-preferences.ts";

const MIN_FONT_SCALE = MARKDOWN_FONT_SCALES[0] ?? 0.75;
const MAX_FONT_SCALE = MARKDOWN_FONT_SCALES.at(-1) ?? 2;

function isMarkdownFontScale(value: number): value is MarkdownFontScale {
  return (MARKDOWN_FONT_SCALES as readonly number[]).includes(value);
}

export function MarkdownPreviewFontScaleControl({
  fontScale,
  labels,
  onChange,
}: {
  fontScale: MarkdownFontScale;
  labels: MarkdownPreviewZoomLabels;
  onChange: (next: MarkdownFontScale) => void;
}) {
  return (
    <ImagePreviewControls
      effectiveZoom={fontScale}
      includeFit={false}
      labels={{
        actualSize: labels.reset,
        controlsLabel: labels.controlsLabel,
        zoomIn: labels.zoomIn,
        zoomLevel: labels.zoomLevel,
        zoomOut: labels.zoomOut,
      }}
      maxZoom={MAX_FONT_SCALE}
      minZoom={MIN_FONT_SCALE}
      onZoomChange={(next) => {
        if (typeof next === "number" && isMarkdownFontScale(next)) {
          onChange(next);
        }
      }}
      onZoomIn={() => onChange(cycleMarkdownFontScale(fontScale, "in"))}
      onZoomOut={() => onChange(cycleMarkdownFontScale(fontScale, "out"))}
      presets={MARKDOWN_FONT_SCALES}
      zoom={fontScale}
    />
  );
}
