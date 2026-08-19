"use client";

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
    source,
    stageControlLabels,
  } = props;
  const isStage = presentation === "stage";
  const keyboardSelectable = onSelectNode !== undefined;
  const mermaidSource = source ?? mermaidFlowchart({ direction, edges, nodes });
  const hostRef = useRef<HTMLDivElement>(null);
  const rootsRef = useRef(new Map<string, Root>());
  const paintRef = useRef<() => void>(() => undefined);
  const [failed, setFailed] = useState(false);
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

  const mermaidHost = (
    <div
      className={cn(
        isStage ? "max-w-none" : "max-h-[720px] overflow-auto",
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
    </MermaidShell>
  );
}
