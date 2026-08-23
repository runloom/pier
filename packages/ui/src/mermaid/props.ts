import type { ReactNode } from "react";
import type { ImagePreviewCanvasLabels } from "../image-preview/controls.tsx";
import type { MermaidDirection, MermaidEdge, MermaidNode } from "./model.ts";

export type MermaidStageControlLabels = Pick<
  ImagePreviewCanvasLabels,
  "actualSize" | "controlsLabel" | "fit" | "zoomIn" | "zoomLevel" | "zoomOut"
>;

export interface MermaidProps {
  "aria-label": string;
  className?: string | undefined;
  direction?: MermaidDirection | undefined;
  edges?: readonly MermaidEdge[] | undefined;
  emptyText?: string | undefined;
  /**
   * Top-right fullscreen control on the card. Default true.
   * Requires `onOpenFullscreen` (host content preview).
   */
  expandable?: boolean | undefined;
  expandLabel?: string | undefined;
  nodes?: readonly MermaidNode[] | undefined;
  onOpenFullscreen?: (() => void) | undefined;
  onSelectNode?: ((id: string) => void) | undefined;
  presentation?: "card" | "stage" | undefined;
  renderNodeContent?: ((node: MermaidNode) => ReactNode) | undefined;
  selectedId?: string | undefined;
  /**
   * Copy shown next to the shrink hint chip when the inline diagram is scaled
   * below its natural width. Omit for an icon-only chip.
   */
  shrinkHint?: string | undefined;
  /**
   * Native mermaid source. Sequence, state, class, ER, and mindmap use this
   * so mermaid owns those families. When set, layout ignores `nodes` / `edges`.
   * Architecture / flowchart cards write mermaid `flowchart` from `nodes` /
   * `edges` when omitted.
   */
  source?: string | undefined;
  stageControlLabels?: MermaidStageControlLabels | undefined;
}
