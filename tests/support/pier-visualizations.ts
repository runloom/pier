import * as visualizationRuntime from "@/lib/live-modules/pier-visualizations-runtime.tsx";

export const mountDiagram = (
  ...args: Parameters<
    typeof visualizationRuntime.pierVisualizationsRuntime.mountDiagram
  >
) => visualizationRuntime.pierVisualizationsRuntime.mountDiagram(...args);
export default visualizationRuntime.pierVisualizationsRuntime;
export type {
  DiagramController,
  DiagramDocument,
  DiagramEdge,
  DiagramNode,
  MountDiagramRequest,
} from "@shared/contracts/visualizations.ts";
