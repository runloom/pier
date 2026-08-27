import type { ComponentType, ReactNode } from "react";

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

export type MermaidDirection = "left-to-right" | "top-to-bottom";
export type MermaidTone =
  | "danger"
  | "done"
  | "info"
  | "muted"
  | "success"
  | "warning";
/**
 * Architecture role. Use on layered / main-loop graphs.
 * Do not reuse `tone` as decoration — `tone` is status only.
 */
export type MermaidKind = "actor" | "agent" | "artifact" | "external" | "tool";
/** Live run state for DAG / pipeline nodes (orthogonal to `tone`/`kind`). */
export type MermaidRunStatus =
  | "failed"
  | "queued"
  | "running"
  | "skipped"
  | "success";
export type MermaidShape = "circle" | "diamond" | "rect" | "round";

export interface MermaidNode {
  /**
   * Reserved height (px) for `renderNodeContent` output. Required whenever
   * the slot renders for this node so layout spaces neighbors correctly.
   */
  contentHeight?: number;
  id: string;
  kind?: MermaidKind;
  meta?: string;
  shape?: MermaidShape;
  /** Live run state — trailing glyph in the title row (spinner / check / x). */
  status?: MermaidRunStatus;
  /** Accessible name for the status glyph; defaults to the status word. */
  statusLabel?: string;
  title: string;
  /** Status tint (error / success / in-progress). Wins over `kind` chrome. */
  tone?: MermaidTone;
}

export interface MermaidEdge {
  id?: string;
  label?: string;
  source: string;
  target: string;
}

export interface MermaidProps {
  "aria-label": string;
  className?: string;
  direction?: MermaidDirection;
  edges?: readonly MermaidEdge[];
  emptyText?: string;
  /**
   * Top-right fullscreen control. Default true.
   * Host canvas wires this to content preview (same shell as image preview).
   */
  expandable?: boolean;
  /** aria-label / title for expand control. */
  expandLabel?: string;
  nodes?: readonly MermaidNode[];
  /** Override host content-preview open (tests / custom shells). */
  onOpenFullscreen?: () => void;
  onSelectNode?: (id: string) => void;
  /**
   * `card` (default) bordered inline overview; `stage` borderless fill for
   * ContentPreviewHost with bottom zoom controls.
   */
  presentation?: "card" | "stage";
  /**
   * Embedded component slot rendered inside each node card below title/meta
   * (progress, timings, badges — display chrome, not interactive controls).
   * Nodes that render content must set `contentHeight`; return null for
   * nodes without extra content.
   */
  renderNodeContent?: (node: MermaidNode) => ReactNode;
  selectedId?: string;
  /**
   * Native mermaid source. Sequence, state, class, ER, and mindmap use this.
   * Architecture / flowchart cards use `nodes` / `edges` when `source` is omitted.
   */
  source?: string;
}

export type FlowGraphDirection = "left-to-right" | "top-to-bottom";
export type FlowGraphNodeStatus =
  | "blocked"
  | "failed"
  | "queued"
  | "ready"
  | "running"
  | "skipped"
  | "success";

export interface FlowGraphNode {
  /** Corner chip. Display only. */
  badge?: string;
  /** Reserved height (px) for `renderNodeContent`. */
  contentHeight?: number;
  /** Opaque payload for the canvas author; the primitive does not render it. */
  data?: unknown;
  id: string;
  label: string;
  /** Secondary line under the title. */
  meta?: string;
  status?: FlowGraphNodeStatus;
  statusLabel?: string;
}

export interface FlowGraphEdge {
  id?: string;
  label?: string;
  source: string;
  target: string;
}

export type FlowGraphPositions = Record<string, { x: number; y: number }>;

export interface FlowGraphOverlayLayout {
  height: number;
  positions: FlowGraphPositions;
  width: number;
}

export interface FlowGraphProps {
  "aria-label": string;
  className?: string;
  direction?: FlowGraphDirection;
  edges?: readonly FlowGraphEdge[];
  emptyText?: string;
  expandable?: boolean;
  expandLabel?: string;
  nodes?: readonly FlowGraphNode[];
  onNodePositionsChange?: (positions: FlowGraphPositions) => void;
  onSelectNode?: (id: string) => void;
  positions?: FlowGraphPositions;
  presentation?: "card" | "plain" | "stage";
  /**
   * Display chrome under the title. That node must set `contentHeight`.
   * Interactive controls belong beside the graph, not inside the node.
   */
  renderNodeContent?: (node: FlowGraphNode) => ReactNode;
  /** Marks anchored to laid-out node positions (gates, captions). */
  renderOverlay?: (layout: FlowGraphOverlayLayout) => ReactNode;
  selectedId?: string;
}

export const DataChart: ComponentType<DataChartProps>;
export const FlowGraph: ComponentType<FlowGraphProps>;
export const Mermaid: ComponentType<MermaidProps>;
/** Layered layout. Pass no `positions` (or `{}`) to recompute ranks. */
export const layoutFlowGraph: (input: {
  direction?: FlowGraphDirection;
  edges: readonly FlowGraphEdge[];
  nodes: readonly { contentHeight?: number; id: string; meta?: string }[];
  positions?: FlowGraphPositions;
}) => FlowGraphOverlayLayout;
