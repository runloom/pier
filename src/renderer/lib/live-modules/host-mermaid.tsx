import { Mermaid, type MermaidProps } from "@pier/ui/mermaid.tsx";
import { openMermaidPreview } from "@/stores/content-preview.store.ts";

/**
 * Canvas / host Mermaid — fullscreen routes through ContentPreviewHost
 * (same shell + bottom zoom strip as markdown image / mermaid fences).
 */
export function HostMermaid(props: MermaidProps) {
  const { onOpenFullscreen, expandable = true, ...rest } = props;
  return (
    <Mermaid
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
              openMermaidPreview({
                "aria-label": rest["aria-label"],
                edges: rest.edges ?? [],
                nodes: rest.nodes ?? [],
                ...(rest.direction ? { direction: rest.direction } : {}),
                ...(rest.source ? { source: rest.source } : {}),
                title: rest["aria-label"],
              });
            }
      }
    />
  );
}
