import type {
  DiagramController,
  MountDiagramRequest,
  PierVisualizationsRuntime,
} from "@shared/contracts/visualizations.ts";
import { createElement } from "react";
import { createRoot } from "react-dom/client";
import { HostNodeGraph } from "./host-node-graph.tsx";
import { MermaidDiagram } from "./mermaid-diagram.tsx";

function diagramElement(request: MountDiagramRequest) {
  if (request.document.format === "mermaid") {
    return createElement(MermaidDiagram, {
      "aria-label": request.ariaLabel,
      source: request.document.source,
    });
  }
  return createElement(HostNodeGraph, {
    "aria-label": request.ariaLabel,
    direction: request.document.direction,
    edges: request.document.edges,
    editable: request.editable,
    nodes: request.document.nodes,
    onConnectNodes: request.onConnectNodes,
    onNodePositionChange: request.onNodePositionChange,
    onSelectNode: request.onSelectNode,
  });
}

function mountDiagram(
  container: HTMLElement,
  initialRequest: MountDiagramRequest
): DiagramController {
  const root = createRoot(container);
  let disposed = false;
  const render = (request: MountDiagramRequest) => {
    if (!disposed) {
      root.render(diagramElement(request));
    }
  };
  render(initialRequest);
  return {
    dispose() {
      if (disposed) {
        return;
      }
      disposed = true;
      root.unmount();
    },
    update(request) {
      render(request);
    },
  };
}

export const pierVisualizationsRuntime: PierVisualizationsRuntime = {
  mountDiagram,
};
