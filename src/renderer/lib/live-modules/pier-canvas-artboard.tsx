/**
 * Host artboard primitives for `pier/canvas`.
 *
 * `Artboard` is a Figma frame: fixed pixel size, default 1280×800 clip
 * viewport (no inner scrollbar). `ArtboardStage` is the flow-mode fit-all
 * card (same chrome as Mermaid). `WorldStage` is the board-mode root — the
 * files preview switches to a viewport-locked zoom/pan shell when it sees
 * `data-canvas-stage="world"`. Interaction stays in image-preview; these
 * primitives only lay out frames on the world plane.
 */
import { HtmlWorldCanvas } from "@pier/ui/image-preview/world-canvas.tsx";
import { cn } from "@pier/ui/utils.ts";
import {
  Children,
  isValidElement,
  type ReactElement,
  type ReactNode,
  type RefObject,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { openHtmlWorldPreview } from "@/stores/content-preview.store.ts";
import { ArtboardCaption } from "./pier-canvas-artboard-caption.tsx";
import { worldStageCaptionVars } from "./pier-canvas-world-ink.ts";

const DEFAULT_ARTBOARD_WIDTH = 1280;
const DEFAULT_ARTBOARD_HEIGHT = 800;
const DEFAULT_STAGE_COLUMNS = 3;
const DEFAULT_GAP = 56;
const DEFAULT_PADDING = 48;

export const ARTBOARD_PRESETS = {
  desktop: { height: 800, width: 1280 },
  laptop: { height: 900, width: 1440 },
  phone: { height: 852, width: 393 },
  tablet: { height: 1194, width: 834 },
} as const;

export type ArtboardPreset = keyof typeof ARTBOARD_PRESETS;

export interface LayerProps {
  children?: ReactNode;
  className?: string;
  h?: number;
  w?: number;
  x: number;
  y: number;
}

export function resolveArtboardSize(input: {
  height?: number | undefined;
  preset?: ArtboardPreset | undefined;
  width?: number | undefined;
}): { height: number; width: number } {
  const preset = input.preset ? ARTBOARD_PRESETS[input.preset] : undefined;
  return {
    height: input.height ?? preset?.height ?? DEFAULT_ARTBOARD_HEIGHT,
    width: input.width ?? preset?.width ?? DEFAULT_ARTBOARD_WIDTH,
  };
}

export function worldStageLayerBounds(
  layers: readonly {
    h?: number | undefined;
    w?: number | undefined;
    x: number;
    y: number;
  }[]
): { height: number; width: number } {
  let width = 0;
  let height = 0;
  for (const layer of layers) {
    width = Math.max(width, layer.x + (layer.w ?? 0));
    height = Math.max(height, layer.y + (layer.h ?? 0));
  }
  return { height, width };
}

function isLayerElement(node: ReactNode): node is ReactElement<LayerProps> {
  return isValidElement(node) && node.type === Layer;
}

function worldStagePlaneSize(input: {
  children?: ReactNode;
  gap: number;
  height?: number | undefined;
  padding: number;
  width?: number | undefined;
}): { height?: number | undefined; width?: number | undefined } {
  if (input.width !== undefined && input.height !== undefined) {
    return { height: input.height, width: input.width };
  }
  const layers: {
    h?: number | undefined;
    w?: number | undefined;
    x: number;
    y: number;
  }[] = [];
  let hasFlow = false;
  Children.forEach(input.children, (child) => {
    if (isLayerElement(child)) {
      layers.push({
        h: child.props.h,
        w: child.props.w,
        x: child.props.x,
        y: child.props.y,
      });
    } else if (child != null && child !== false) {
      hasFlow = true;
    }
  });
  if (layers.length === 0 && hasFlow) {
    return {
      height: input.height,
      width: input.width ?? stageWorldWidth(input.gap, input.padding),
    };
  }
  if (layers.length > 0 && !hasFlow) {
    const bounds = worldStageLayerBounds(layers);
    return {
      height:
        input.height ??
        (bounds.height > 0 ? bounds.height + input.padding * 2 : undefined),
      width:
        input.width ??
        (bounds.width > 0 ? bounds.width + input.padding * 2 : undefined),
    };
  }
  return {
    height: input.height,
    width: input.width,
  };
}

function stageWorldWidth(gap: number, padding: number): number {
  return (
    DEFAULT_STAGE_COLUMNS * DEFAULT_ARTBOARD_WIDTH +
    (DEFAULT_STAGE_COLUMNS - 1) * gap +
    padding * 2
  );
}

/**
 * Measured envelope of the plane's `Layer` children (DOM truth). Declared
 * `width` / `height` / Layer `w` / `h` stay the fast path; the measurement
 * only grows the plane so content never silently clips (e.g. a DAG relayout
 * taller than the hand-written stage height). Layers are absolutely
 * positioned, so measuring them cannot re-wrap flow children.
 */
function useWorldStageEnvelope(
  planeRef: RefObject<HTMLDivElement | null>,
  padding: number
): { height: number; width: number } | null {
  const [measured, setMeasured] = useState<{
    height: number;
    width: number;
  } | null>(null);
  useLayoutEffect(() => {
    const plane = planeRef.current;
    if (!plane || typeof ResizeObserver === "undefined") {
      return;
    }
    const measure = () => {
      let width = 0;
      let height = 0;
      for (const child of plane.children) {
        if (
          !(child instanceof HTMLElement) ||
          child.dataset.slot !== "canvas-layer"
        ) {
          continue;
        }
        width = Math.max(width, child.offsetLeft + child.offsetWidth);
        height = Math.max(height, child.offsetTop + child.offsetHeight);
      }
      if (!(width > 0 || height > 0)) {
        setMeasured(null);
        return;
      }
      const next = { height: height + padding, width: width + padding };
      setMeasured((current) =>
        current &&
        Math.abs(current.width - next.width) < 1 &&
        Math.abs(current.height - next.height) < 1
          ? current
          : next
      );
    };
    const sizes = new ResizeObserver(measure);
    const attach = () => {
      sizes.disconnect();
      sizes.observe(plane);
      for (const child of plane.children) {
        if (
          child instanceof HTMLElement &&
          child.dataset.slot === "canvas-layer"
        ) {
          sizes.observe(child);
        }
      }
      measure();
    };
    attach();
    // Re-wire when layers mount/unmount.
    const mutations = new MutationObserver(attach);
    mutations.observe(plane, {
      childList: true,
    });
    return () => {
      sizes.disconnect();
      mutations.disconnect();
    };
  }, [planeRef, padding]);
  return measured;
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

/**
 * WorldStage — root primitive for board-mode canvases. The files preview
 * detects `data-canvas-stage="world"` on the mounted root and switches the
 * shell from the reading flow to a viewport-locked zoom/pan stage.
 */
export function WorldStage({
  background,
  children,
  className,
  gap = DEFAULT_GAP,
  height,
  padding = DEFAULT_PADDING,
  width,
}: {
  background?: string;
  children?: ReactNode;
  className?: string;
  gap?: number;
  height?: number;
  padding?: number;
  /**
   * Wrap line width in px. Flow children default to the ArtboardStage
   * 3×desktop line so wrap actually happens; Layer children envelope from
   * the DOM — declared numbers are a floor, never a clip.
   */
  width?: number;
}) {
  const planeRef = useRef<HTMLDivElement | null>(null);
  const declared = worldStagePlaneSize({
    children,
    gap,
    height,
    padding,
    width,
  });
  const envelope = useWorldStageEnvelope(planeRef, padding);
  const planeWidth =
    declared.width !== undefined || envelope?.width !== undefined
      ? Math.max(declared.width ?? 0, envelope?.width ?? 0)
      : undefined;
  const planeHeight =
    declared.height !== undefined || envelope?.height !== undefined
      ? Math.max(declared.height ?? 0, envelope?.height ?? 0)
      : undefined;
  const captionInk = worldStageCaptionVars(background);
  return (
    <div
      className={className}
      data-canvas-stage="world"
      ref={planeRef}
      style={{
        alignItems: "flex-start",
        background,
        boxSizing: "border-box",
        display: "flex",
        flexWrap: "wrap",
        gap: `${gap}px`,
        height: planeHeight,
        minHeight: "100%",
        minWidth: "100%",
        padding: `${padding}px`,
        position: "relative",
        width: planeWidth,
        ...(captionInk ?? {}),
      }}
    >
      {children}
    </div>
  );
}

/** Absolute child of `WorldStage` (`x`/`y` world pixels; `w`/`h` optional). */
export function Layer({ children, className, h, w, x, y }: LayerProps) {
  return (
    <div
      className={className}
      data-slot="canvas-layer"
      style={{
        height: h,
        left: x,
        position: "absolute",
        top: y,
        width: w ?? "max-content",
      }}
    >
      {children}
    </div>
  );
}

export function Artboard({
  children,
  className,
  description,
  height: heightProp,
  label,
  overflow = "clip",
  preset,
  title,
  width: widthProp,
}: {
  children?: ReactNode;
  className?: string;
  description?: string | undefined;
  height?: number;
  label?: string | undefined;
  /** `clip` matches Figma clip-content. `scroll` is prototype overflow only. */
  overflow?: "clip" | "scroll";
  preset?: ArtboardPreset;
  title?: string | undefined;
  width?: number;
}) {
  const { height, width } = resolveArtboardSize({
    height: heightProp,
    preset,
    width: widthProp,
  });
  const heading = title ?? label ?? "Artboard";

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
      <ArtboardCaption
        description={description}
        heading={heading}
        label={label}
        title={title}
      />
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
