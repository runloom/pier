export type DiagramDirection = "left-to-right" | "top-to-bottom";
export type DiagramNodeTone =
  | "danger"
  | "done"
  | "info"
  | "muted"
  | "success"
  | "warning";

export interface DiagramNode {
  id: string;
  meta?: string;
  position?: { x: number; y: number };
  title: string;
  tone?: DiagramNodeTone;
}

export interface DiagramEdge {
  id?: string;
  label?: string;
  source: string;
  target: string;
}

export type DiagramDocument =
  | {
      format: "mermaid";
      source: string;
      version: 1;
    }
  | {
      direction?: DiagramDirection;
      edges: DiagramEdge[];
      format: "node-graph";
      nodes: DiagramNode[];
      version: 1;
    };

export interface MountDiagramRequest {
  ariaLabel: string;
  document: DiagramDocument;
  editable?: boolean;
  onConnectNodes?: (connection: { source: string; target: string }) => void;
  onNodePositionChange?: (
    id: string,
    position: { x: number; y: number }
  ) => void;
  onSelectNode?: (id: string) => void;
}

export interface DiagramController {
  dispose(): void;
  update(request: MountDiagramRequest): void;
}

export interface PierVisualizationsRuntime {
  mountDiagram(
    container: HTMLElement,
    request: MountDiagramRequest
  ): DiagramController;
}
