import type { ComponentType } from "react";

export type DataChartDatum = Record<string, number | string | null | undefined>;

export interface DataChartSeries {
  key: string;
  label: string;
  tone?: 1 | 2 | 3 | 4 | 5;
}

export interface DataChartProps {
  "aria-label": string;
  categoryKey: string;
  className?: string;
  data: readonly DataChartDatum[];
  emptyText?: string;
  height?: number;
  onDatumSelect?: (datum: DataChartDatum, index: number) => void;
  series: readonly DataChartSeries[];
  showGrid?: boolean;
  showLegend?: boolean;
  type: "area" | "bar" | "donut" | "line";
  valueFormatter?: (value: number) => string;
}

export type NodeGraphDirection = "left-to-right" | "top-to-bottom";
export type NodeGraphTone =
  | "danger"
  | "done"
  | "info"
  | "muted"
  | "success"
  | "warning";

export interface NodeGraphNode {
  id: string;
  meta?: string;
  position?: { x: number; y: number };
  title: string;
  tone?: NodeGraphTone;
}

export interface NodeGraphEdge {
  id?: string;
  label?: string;
  source: string;
  target: string;
}

export interface NodeGraphProps {
  "aria-label": string;
  className?: string;
  direction?: NodeGraphDirection;
  edges: readonly NodeGraphEdge[];
  editable?: boolean;
  emptyText?: string;
  /**
   * Top-right fullscreen control. Default true.
   * Host canvas wires this to content preview (same shell as mermaid/image).
   */
  expandable?: boolean;
  /** aria-label / title for expand control. */
  expandLabel?: string;
  highlightedIds?: ReadonlySet<string>;
  nodes: readonly NodeGraphNode[];
  onConnectNodes?: (connection: { source: string; target: string }) => void;
  onNodePositionChange?: (
    id: string,
    position: { x: number; y: number }
  ) => void;
  /** Override host content-preview open (tests / custom shells). */
  onOpenFullscreen?: () => void;
  onSelectNode?: (id: string) => void;
  /**
   * `card` (default) bordered inline overview; `stage` borderless fill for
   * ContentPreviewHost with bottom zoom controls.
   */
  presentation?: "card" | "stage";
  selectedId?: string;
}

export interface MermaidDiagramProps {
  "aria-label": string;
  className?: string;
  emptyText?: string;
  errorText?: string;
  /** Top-right fullscreen into host content preview. Default true. */
  expandable?: boolean;
  expandLabel?: string;
  loadingText?: string;
  previewTitle?: string;
  source: string;
}

export const DataChart: ComponentType<DataChartProps>;
export const NodeGraph: ComponentType<NodeGraphProps>;
export const MermaidDiagram: ComponentType<MermaidDiagramProps>;
