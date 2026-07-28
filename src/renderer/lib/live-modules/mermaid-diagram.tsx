import { cn } from "@pier/ui/utils.ts";
import { useEffect, useRef, useState } from "react";
import { useThemeStore } from "@/stores/theme.store.ts";
import { officialMermaidRenderer } from "./official-mermaid-renderer.ts";

export interface MermaidDiagramProps {
  "aria-label": string;
  className?: string;
  emptyText?: string;
  errorText?: string;
  loadingText?: string;
  source: string;
}

type MermaidDiagramState =
  | { status: "empty" }
  | { status: "error"; message: string }
  | { status: "loading" }
  | { diagramType: string; status: "ready"; svg: string };

export function MermaidDiagram({
  "aria-label": ariaLabel,
  className,
  emptyText = "Enter Mermaid source to preview a diagram.",
  errorText = "This Mermaid diagram could not be rendered.",
  loadingText = "Rendering diagram…",
  source,
}: MermaidDiagramProps) {
  const theme = useThemeStore((state) => state.resolvedTheme);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const [state, setState] = useState<MermaidDiagramState>(() =>
    source.trim() ? { status: "loading" } : { status: "empty" }
  );

  useEffect(() => {
    if (!source.trim()) {
      setState({ status: "empty" });
      return;
    }

    let active = true;
    setState({ status: "loading" });
    const timer = window.setTimeout(() => {
      officialMermaidRenderer.render(source, theme).then((result) => {
        if (!active) {
          return;
        }
        setState(
          result.ok
            ? {
                diagramType: result.diagramType,
                status: "ready",
                svg: result.svg,
              }
            : { message: result.message, status: "error" }
        );
      });
    }, 160);

    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [source, theme]);

  useEffect(() => {
    const root = rootRef.current;
    if (!(root && state.status === "ready")) {
      return;
    }
    const documentNode = new DOMParser().parseFromString(
      state.svg,
      "image/svg+xml"
    );
    const svg = documentNode.documentElement;
    if (svg.localName !== "svg" || documentNode.querySelector("parsererror")) {
      setState({
        message: "Mermaid returned invalid SVG.",
        status: "error",
      });
      return;
    }
    root.replaceChildren(document.importNode(svg, true));
    return () => root.replaceChildren();
  }, [state]);

  return (
    <div
      aria-busy={state.status === "loading"}
      aria-label={ariaLabel}
      className={cn(
        "relative grid min-h-48 min-w-0 place-items-center overflow-auto rounded-lg border bg-muted/20 p-3",
        className
      )}
      data-diagram-type={
        state.status === "ready" ? state.diagramType : undefined
      }
      data-slot="mermaid-diagram"
      role="img"
    >
      <div
        className={cn(
          "w-full min-w-0 [&>svg]:mx-auto [&>svg]:h-auto [&>svg]:max-h-full [&>svg]:max-w-full",
          state.status !== "ready" && "hidden"
        )}
        data-slot="mermaid-diagram-svg"
        ref={rootRef}
      />
      {state.status === "loading" ? (
        <span className="text-muted-foreground text-xs">{loadingText}</span>
      ) : null}
      {state.status === "empty" ? (
        <span className="text-muted-foreground text-xs">{emptyText}</span>
      ) : null}
      {state.status === "error" ? (
        <div className="max-w-lg text-center">
          <strong className="font-medium text-status-danger-fg text-xs">
            {errorText}
          </strong>
          <pre className="mt-2 whitespace-pre-wrap font-mono text-[10px] text-muted-foreground">
            {state.message}
          </pre>
        </div>
      ) : null}
    </div>
  );
}
