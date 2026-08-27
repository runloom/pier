import { FlowGraph, type FlowGraphProps } from "@pier/ui/flow-graph/index.tsx";
import { useContext } from "react";
import { openHtmlWorldPreview } from "@/stores/content-preview.store.ts";
import { CanvasStageContext } from "./pier-canvas-artboard.tsx";

/**
 * Canvas FlowGraph — flow mode uses the fit-all card; world mode lays the
 * plane on the board. Fullscreen reuses the html-world content preview.
 */
export function HostFlowGraph(props: FlowGraphProps) {
  const stage = useContext(CanvasStageContext);
  const { expandable = true, onOpenFullscreen, presentation, ...rest } = props;
  const resolvedPresentation =
    presentation ?? (stage === "world" ? "plain" : "card");
  const canExpand = resolvedPresentation === "card" && expandable !== false;

  if (!canExpand) {
    return (
      <FlowGraph
        {...rest}
        expandable={false}
        presentation={resolvedPresentation}
      />
    );
  }

  return (
    <FlowGraph
      {...rest}
      expandable
      onOpenFullscreen={() => {
        if (onOpenFullscreen) {
          onOpenFullscreen();
          return;
        }
        openHtmlWorldPreview({
          "aria-label": rest["aria-label"],
          render: () => (
            <FlowGraph {...rest} expandable={false} presentation="stage" />
          ),
          title: rest["aria-label"],
        });
      }}
      presentation={resolvedPresentation}
    />
  );
}
