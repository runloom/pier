import { NodeGraph, type NodeGraphProps } from "@pier/ui/node-graph.tsx";
import { openNodeGraphPreview } from "@/stores/content-preview.store.ts";

/**
 * Canvas / host NodeGraph — fullscreen routes through ContentPreviewHost
 * (same shell + bottom zoom strip as markdown image / mermaid).
 */
export function HostNodeGraph(props: NodeGraphProps) {
  const { onOpenFullscreen, expandable = true, ...rest } = props;
  return (
    <NodeGraph
      {...rest}
      expandable={expandable}
      onOpenFullscreen={
        expandable === false
          ? onOpenFullscreen
          : () => {
              if (onOpenFullscreen) {
                onOpenFullscreen();
                return;
              }
              openNodeGraphPreview({
                "aria-label": rest["aria-label"],
                edges: rest.edges,
                nodes: rest.nodes,
                ...(rest.direction ? { direction: rest.direction } : {}),
                title: rest["aria-label"],
              });
            }
      }
    />
  );
}
