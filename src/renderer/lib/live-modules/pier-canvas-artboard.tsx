/**
 * Host artboard primitives for `pier/canvas` (ArtboardStage / Artboard).
 *
 * Artboard is a Figma frame: fixed pixel width, default 1280×800 clip viewport
 * (no inner scrollbar). Inline ArtboardStage is the same fit-all card as
 * Mermaid / node-graph (no wheel capture). Zoom/pan is fullscreen only.
 */
import { HtmlWorldCanvas } from "@pier/ui/image-preview/world-canvas.tsx";
import { cn } from "@pier/ui/utils.ts";
import type { ReactNode } from "react";
import { openHtmlWorldPreview } from "@/stores/content-preview.store.ts";
import { Text } from "./pier-canvas-layout.ts";

const DEFAULT_ARTBOARD_WIDTH = 1280;
const DEFAULT_ARTBOARD_HEIGHT = 800;
const DEFAULT_STAGE_COLUMNS = 3;
const DEFAULT_GAP = 56;
const DEFAULT_PADDING = 48;

function stageWorldWidth(gap: number, padding: number): number {
  return (
    DEFAULT_STAGE_COLUMNS * DEFAULT_ARTBOARD_WIDTH +
    (DEFAULT_STAGE_COLUMNS - 1) * gap +
    padding * 2
  );
}

function ArtboardWorld({
  children,
  gap,
  padding,
  width,
}: {
  children?: ReactNode;
  gap: number;
  padding: number;
  width: number;
}) {
  return (
    <div
      data-slot="artboard-world"
      style={{
        alignItems: "flex-start",
        boxSizing: "border-box",
        display: "flex",
        flexWrap: "wrap",
        gap: `${gap}px`,
        padding: `${padding}px`,
        width,
      }}
    >
      {children}
    </div>
  );
}

export function ArtboardStage({
  children,
  className,
  expandLabel = "View fullscreen",
  expandable = true,
  gap = DEFAULT_GAP,
  padding = DEFAULT_PADDING,
  title,
  worldWidth,
}: {
  children?: ReactNode;
  className?: string;
  expandLabel?: string;
  expandable?: boolean;
  gap?: number;
  padding?: number;
  title?: string;
  worldWidth?: number;
}) {
  const heading = title ?? "Artboard";
  const width = worldWidth ?? stageWorldWidth(gap, padding);
  const world = (
    <ArtboardWorld gap={gap} padding={padding} width={width}>
      {children}
    </ArtboardWorld>
  );

  return (
    <div className={cn("w-full min-w-0", className)} data-slot="artboard-stage">
      <HtmlWorldCanvas
        className="bg-background"
        expandable={expandable}
        expandLabel={expandLabel}
        viewerLabel={heading}
        {...(expandable
          ? {
              onOpenFullscreen: () => {
                openHtmlWorldPreview({
                  "aria-label": heading,
                  render: () => (
                    <ArtboardWorld gap={gap} padding={padding} width={width}>
                      {children}
                    </ArtboardWorld>
                  ),
                  title: heading,
                });
              },
            }
          : {})}
      >
        {world}
      </HtmlWorldCanvas>
    </div>
  );
}

export function Artboard({
  children,
  className,
  description,
  height = DEFAULT_ARTBOARD_HEIGHT,
  label,
  overflow = "clip",
  title,
  width = DEFAULT_ARTBOARD_WIDTH,
}: {
  children?: ReactNode;
  className?: string;
  description?: string;
  height?: number;
  label?: string;
  /** `clip` matches Figma clip-content. `scroll` is prototype overflow only. */
  overflow?: "clip" | "scroll";
  title?: string;
  width?: number;
}) {
  const heading = title ?? label ?? "Artboard";
  const caption =
    label && title ? (
      <div
        style={{
          alignItems: "baseline",
          display: "flex",
          flexWrap: "wrap",
          gap: 8,
          minWidth: 0,
        }}
      >
        <Text className="font-mono text-muted-foreground text-xs">{label}</Text>
        <Text as="h3" className="font-medium text-sm">
          {title}
        </Text>
      </div>
    ) : (
      <Text as="h3" className="font-medium text-sm">
        {heading}
      </Text>
    );

  return (
    <section
      aria-label={heading}
      className={className}
      data-slot="artboard"
      style={{
        display: "flex",
        flexDirection: "column",
        flexShrink: 0,
        gap: 10,
        width,
      }}
    >
      <div
        data-slot="artboard-caption"
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 6,
          maxWidth: 720,
          minWidth: 0,
        }}
      >
        {caption}
        {description ? (
          <Text className="text-muted-foreground text-xs leading-relaxed">
            {description}
          </Text>
        ) : null}
      </div>
      <div
        data-slot="artboard-frame"
        style={{
          backgroundColor: "var(--background)",
          border: "1px solid var(--border)",
          borderRadius: 12,
          boxSizing: "border-box",
          height,
          overflow: overflow === "scroll" ? "auto" : "hidden",
          width: "100%",
        }}
      >
        {children}
      </div>
    </section>
  );
}
