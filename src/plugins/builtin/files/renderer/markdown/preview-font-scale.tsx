import { Button } from "@pier/ui/button.tsx";
import { Minus, Plus } from "lucide-react";
import type { MarkdownFontScale } from "./preview-preferences.ts";
import { cycleMarkdownFontScale } from "./preview-preferences.ts";
import { MARKDOWN_PREVIEW_EDGE_INSET_PX } from "./preview-toc-layout.ts";

export function MarkdownPreviewFontScaleControl({
  fontScale,
  labels,
  onChange,
}: {
  fontScale: MarkdownFontScale;
  labels: {
    reset: string;
    zoomIn: string;
    zoomOut: string;
  };
  onChange: (next: MarkdownFontScale) => void;
}) {
  return (
    <div
      aria-label={`${labels.reset}: ${Math.round(fontScale * 100)}%`}
      className="absolute z-10 flex items-center gap-0.5 rounded-md border border-border bg-background/95 p-0.5 shadow-sm"
      data-slot="markdown-font-scale"
      role="toolbar"
      style={{
        right: MARKDOWN_PREVIEW_EDGE_INSET_PX,
        bottom: MARKDOWN_PREVIEW_EDGE_INSET_PX,
      }}
    >
      <Button
        aria-label={labels.zoomOut}
        onClick={() => onChange(cycleMarkdownFontScale(fontScale, "out"))}
        size="icon-xs"
        type="button"
        variant="ghost"
      >
        <Minus data-icon="inline-start" />
      </Button>
      <Button
        aria-label={labels.reset}
        className="min-w-10 tabular-nums"
        onClick={() => onChange(1)}
        size="xs"
        type="button"
        variant="ghost"
      >
        {Math.round(fontScale * 100)}%
      </Button>
      <Button
        aria-label={labels.zoomIn}
        onClick={() => onChange(cycleMarkdownFontScale(fontScale, "in"))}
        size="icon-xs"
        type="button"
        variant="ghost"
      >
        <Plus data-icon="inline-start" />
      </Button>
    </div>
  );
}
