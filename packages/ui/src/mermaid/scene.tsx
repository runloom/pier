"use client";

import { Maximize2 } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import type { ImagePreviewCanvasLabels } from "../image-preview/controls.tsx";
import { HtmlWorldCanvas } from "../image-preview/world-canvas.tsx";
import { cn } from "../utils.ts";
import { MermaidMark } from "./mark.tsx";
import { SLOT_ATTR } from "./model.ts";
import type { MermaidProps } from "./props.ts";
import { MermaidEmpty, MermaidShell } from "./shell.tsx";
import { mermaidFlowchart, renderMermaid } from "./theme.ts";

const DEFAULT_STAGE_LABELS: ImagePreviewCanvasLabels = {
  actualSize: "Actual size",
  controlsLabel: "Zoom controls",
  fit: "Fit to window",
  loadFailedDescription: "",
  loadFailedTitle: "",
  loading: "",
  viewerLabel: "Diagram",
  zoomIn: "Zoom in",
  zoomLevel: "Zoom level",
  zoomOut: "Zoom out",
};

/**
 * True when the rendered diagram's natural width exceeds its container, i.e.
 * mermaid scaled it down. Zero shown width (unmeasured / jsdom) never counts.
 */
export function isDiagramShrunk(
  naturalWidth: number,
  shownWidth: number
): boolean {
  return shownWidth > 0 && naturalWidth > shownWidth + 1;
}

export function MermaidScene(props: MermaidProps) {
  const {
    "aria-label": ariaLabel,
    className,
    direction = "left-to-right",
    edges = [],
    emptyText = "No diagram to display.",
    expandable = true,
    expandLabel = "View fullscreen",
    nodes = [],
    onOpenFullscreen,
    onSelectNode,
    presentation,
    renderNodeContent,
    selectedId,
    shrinkHint,
    source,
    stageControlLabels,
  } = props;
  const isStage = presentation === "stage";
  const keyboardSelectable = onSelectNode !== undefined;
  const mermaidSource = source ?? mermaidFlowchart({ direction, edges, nodes });
  const hostRef = useRef<HTMLDivElement>(null);
  const rootsRef = useRef(new Map<string, Root>());
  const paintRef = useRef<() => void>(() => undefined);
  const measureRef = useRef<() => void>(() => undefined);
  const [failed, setFailed] = useState(false);
  const [shrunk, setShrunk] = useState(false);
  const rawId = useId().replace(/[^a-zA-Z0-9]/g, "");
  const renderId = `mm${rawId || "graph"}`;

  paintRef.current = () => {
    const host = hostRef.current;
    if (!host) {
      return;
    }
    const byId = new Map(nodes.map((node) => [node.id, node]));
    for (const el of host.querySelectorAll(`[${SLOT_ATTR}]`)) {
      const id = el.getAttribute(SLOT_ATTR);
      if (!id) {
        continue;
      }
      const node = byId.get(id);
      if (!node) {
        continue;
      }
      let root = rootsRef.current.get(id);
      if (!root) {
        root = createRoot(el);
        rootsRef.current.set(id, root);
      }
      const content = renderNodeContent?.(node) ?? null;
      root.render(
        <MermaidMark
          content={content}
          keyboardSelectable={keyboardSelectable}
          node={node}
          onSelect={onSelectNode}
          selected={selectedId === id}
        />
      );
    }
  };
  // Latest measurement closure: shared by the resize observer and the
  // post-injection re-measure inside the render effect, so both always see
  // the current props/state without widening effect dependencies.
  measureRef.current = () => {
    if (isStage) {
      return;
    }
    const host = hostRef.current;
    if (!host || failed) {
      return;
    }
    const svg = host.querySelector("svg");
    const natural = svg?.viewBox?.baseVal.width ?? 0;
    setShrunk(isDiagramShrunk(natural, host.clientWidth));
  };

  useEffect(() => {
    let cancelled = false;
    const host = hostRef.current;
    if (!host) {
      return;
    }
    setFailed(false);
    const clearRoots = () => {
      const roots = [...rootsRef.current.values()];
      rootsRef.current.clear();
      queueMicrotask(() => {
        for (const root of roots) {
          root.unmount();
        }
      });
    };
    clearRoots();
    host.replaceChildren();
    renderMermaid(renderId, mermaidSource)
      .then((result) => {
        if (cancelled || !hostRef.current) {
          return;
        }
        hostRef.current.innerHTML = result.svg;
        // createRoot.render is async; flush so every slotted card is in the
        // DOM before tests / click handlers look for titles.
        flushSync(() => {
          paintRef.current();
        });
        // A source swap can leave the host box identical, so the resize
        // observer never fires — re-measure right after injection.
        measureRef.current();
      })
      .catch(() => {
        if (!cancelled) {
          setFailed(true);
        }
      });
    return () => {
      cancelled = true;
      clearRoots();
    };
  }, [mermaidSource, renderId]);

  useEffect(() => {
    paintRef.current();
  });

  // Inline cards only: stage previews own zoom controls already. Re-runs on
  // isStage; source swaps re-measure inside the render effect's .then()
  // because an unchanged host box never triggers the resize observer.
  useEffect(() => {
    if (isStage) {
      setShrunk(false);
      return;
    }
    measureRef.current();
    if (typeof ResizeObserver === "undefined") {
      return;
    }
    const observer = new ResizeObserver(() => measureRef.current());
    if (hostRef.current) {
      observer.observe(hostRef.current);
    }
    return () => {
      observer.disconnect();
    };
  }, [isStage]);

  const mermaidHost = (
    <div
      className={cn(
        isStage ? "max-w-none" : "flex justify-center",
        failed && "hidden"
      )}
      data-slot="mermaid-host"
      ref={hostRef}
    />
  );
  const failedNotice = failed ? (
    <div className="grid min-h-48 place-items-center text-muted-foreground text-sm">
      {emptyText}
    </div>
  ) : null;

  if (nodes.length === 0 && !source) {
    return (
      <MermaidEmpty
        aria-label={ariaLabel}
        className={className}
        isStage={isStage}
        text={emptyText}
      />
    );
  }

  if (isStage) {
    const labels: ImagePreviewCanvasLabels = {
      ...DEFAULT_STAGE_LABELS,
      ...stageControlLabels,
      viewerLabel: ariaLabel,
    };
    return (
      <div className="relative flex h-full min-h-0 flex-1 flex-col">
        <HtmlWorldCanvas
          className="min-h-0 w-full flex-1 bg-background"
          expandable={false}
          labels={labels}
          presentation="stage"
          viewerLabel={ariaLabel}
        >
          <div data-slot="mermaid-stage">
            {mermaidHost}
            {failedNotice}
          </div>
        </HtmlWorldCanvas>
      </div>
    );
  }

  return (
    <MermaidShell
      aria-label={ariaLabel}
      className={className}
      expandLabel={expandLabel}
      keyboardSelectable={keyboardSelectable}
      onOpenFullscreen={onOpenFullscreen}
      showExpand={Boolean(expandable && onOpenFullscreen)}
      surfaceClassName="p-3"
    >
      {mermaidHost}
      {failedNotice}
      {shrunk && !failed ? (
        <div
          aria-hidden
          className="pointer-events-none absolute right-2 bottom-2 z-10 flex items-center gap-1 rounded-full border bg-background/90 px-2 py-0.5 text-muted-foreground text-xs shadow-sm"
          data-slot="mermaid-shrink-hint"
        >
          {shrinkHint ? <span>{shrinkHint}</span> : null}
          <Maximize2 className="size-3" />
        </div>
      ) : null}
    </MermaidShell>
  );
}
