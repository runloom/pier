import { compileWorkflowEdges } from "@pier/ui/canvas-workflow/compile-edges.ts";
import {
  WorkflowEdgeArrows,
  WorkflowEdgeLabels,
  WorkflowEdgeStrokes,
  WorkflowOverlaySvg,
} from "@pier/ui/canvas-workflow/edges.tsx";
import {
  workflowHighlight,
  workflowHighlightActive,
  workflowHoverFromTarget,
} from "@pier/ui/canvas-workflow/highlight.ts";
import {
  artboardBoxAsNode,
  rewriteScreenFlowFixes,
  type ScreenFlowBox,
  type ScreenFlowSpec,
  screenFlowMissingArtboards,
  screenFlowPlacementDiagnostics,
  screenFlowReferencedIds,
  screenFlowStartId,
  validateScreenFlowSpec,
} from "@pier/ui/canvas-workflow/screen-flow.ts";
import type {
  WorkflowHover,
  WorkflowLayout,
} from "@pier/ui/canvas-workflow/types.ts";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@pier/ui/empty.tsx";
import { cn } from "@pier/ui/utils.ts";
import i18next from "i18next";
import {
  type ReactNode,
  useCallback,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useWorldStageScope } from "./pier-canvas-artboard.tsx";

export type { ScreenFlowSpec } from "@pier/ui/canvas-workflow/screen-flow.ts";
export { validateScreenFlowSpec } from "@pier/ui/canvas-workflow/screen-flow.ts";

function copy(
  key: string,
  fallback: string,
  vars: Record<string, string> = {}
): string {
  if (i18next.isInitialized) {
    return i18next.t(key, { defaultValue: fallback, ...vars });
  }
  return Object.entries(vars).reduce(
    (text, [name, value]) => text.replaceAll(`{{${name}}}`, value),
    fallback
  );
}

function emptyHint(
  diagnostics: { message: string; supportedFixes: readonly string[] }[]
) {
  const first = diagnostics[0];
  return copy("canvas.screenFlow.invalidHint", "{{message}} Next: {{fix}}", {
    fix: first?.supportedFixes[0] ?? "",
    message: first?.message ?? "",
  });
}

function EmptyCard({
  className,
  diagnostics,
}: {
  className?: string;
  diagnostics: { message: string; supportedFixes: readonly string[] }[];
}): ReactNode {
  return (
    <Empty className={className} data-screen-flow="invalid">
      <EmptyHeader>
        <EmptyTitle>
          {copy(
            "canvas.screenFlow.invalidTitle",
            "This screen flow can’t be drawn"
          )}
        </EmptyTitle>
        <EmptyDescription>{emptyHint(diagnostics)}</EmptyDescription>
      </EmptyHeader>
    </Empty>
  );
}

function planeVisualScale(
  plane: HTMLElement,
  planeRect: Pick<DOMRect, "width">
): number {
  const layoutWidth = plane.offsetWidth;
  if (!(layoutWidth > 0 && planeRect.width > 0)) {
    return 1;
  }
  return planeRect.width / layoutWidth;
}

function boxFromRect(
  id: string,
  rect: DOMRect,
  plane: HTMLElement,
  planeRect: DOMRect,
  scale: number
): ScreenFlowBox {
  return {
    h: rect.height / scale,
    id,
    w: rect.width / scale,
    x: (rect.left - planeRect.left) / scale + plane.scrollLeft,
    y: (rect.top - planeRect.top) / scale + plane.scrollTop,
  };
}

function readBoxes(plane: HTMLElement): {
  boxes: ScreenFlowBox[];
  captions: Map<string, ScreenFlowBox>;
} {
  const planeRect = plane.getBoundingClientRect();
  const scale = planeVisualScale(plane, planeRect);
  const boxes: ScreenFlowBox[] = [];
  const captions = new Map<string, ScreenFlowBox>();
  for (const el of plane.querySelectorAll("[data-artboard-id]")) {
    if (!(el instanceof HTMLElement)) {
      continue;
    }
    const id = el.dataset.artboardId;
    if (!id) {
      continue;
    }
    const frame = el.querySelector("[data-slot='artboard-frame']");
    if (frame instanceof HTMLElement) {
      boxes.push(
        boxFromRect(id, frame.getBoundingClientRect(), plane, planeRect, scale)
      );
    }
    const caption = el.querySelector("[data-slot='artboard-caption']");
    if (caption instanceof HTMLElement) {
      captions.set(
        id,
        boxFromRect(
          id,
          caption.getBoundingClientRect(),
          plane,
          planeRect,
          scale
        )
      );
    }
  }
  return { boxes, captions };
}

function mountedArtboardIds(plane: HTMLElement): Set<string> {
  const ids = new Set<string>();
  for (const el of plane.querySelectorAll("[data-artboard-id]")) {
    if (el instanceof HTMLElement && el.dataset.artboardId) {
      ids.add(el.dataset.artboardId);
    }
  }
  return ids;
}

function paintLayout(input: {
  edges: WorkflowLayout["edges"];
  height: number;
  nodes: WorkflowLayout["nodes"];
  title: string;
  width: number;
}): WorkflowLayout {
  return {
    diagnostics: [],
    edges: input.edges,
    groups: [],
    height: input.height,
    lanes: [],
    legend: [],
    legendY: 0,
    nodes: input.nodes,
    notes: [],
    notesY: 0,
    phases: [],
    title: input.title,
    width: input.width,
  };
}

export function ScreenFlow({
  className,
  spec,
}: {
  className?: string;
  spec: ScreenFlowSpec;
}): ReactNode {
  const nested = useWorldStageScope();
  const overlayRef = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState<WorkflowHover>(null);
  const [boxes, setBoxes] = useState<ScreenFlowBox[]>([]);
  const [captions, setCaptions] = useState<Map<string, ScreenFlowBox>>(
    () => new Map()
  );
  const [planeSize, setPlaneSize] = useState({ height: 0, width: 0 });
  const [directChild, setDirectChild] = useState(true);
  const [measured, setMeasured] = useState(false);
  const [mountedIds, setMountedIds] = useState<Set<string>>(() => new Set());

  const measure = useCallback(() => {
    const overlay = overlayRef.current;
    const plane = overlay?.closest("[data-canvas-stage='world']");
    if (!(overlay && plane instanceof HTMLElement)) {
      return;
    }
    setDirectChild(overlay.parentElement === plane);
    setMeasured(true);
    setPlaneSize({ height: plane.clientHeight, width: plane.clientWidth });
    setMountedIds(mountedArtboardIds(plane));
    const next = readBoxes(plane);
    setBoxes(next.boxes);
    setCaptions(next.captions);
  }, []);

  const referenced = useMemo(
    () => new Set(screenFlowReferencedIds(spec)),
    [spec]
  );

  useLayoutEffect(() => {
    measure();
    const overlay = overlayRef.current;
    const plane = overlay?.closest("[data-canvas-stage='world']");
    if (!(plane instanceof HTMLElement)) {
      return;
    }
    const observer = new ResizeObserver(() => {
      measure();
    });
    observer.observe(plane);
    for (const el of plane.querySelectorAll("[data-artboard-id]")) {
      if (el instanceof HTMLElement) {
        observer.observe(el);
      }
    }
    return () => {
      observer.disconnect();
    };
  }, [measure]);

  const structure = validateScreenFlowSpec(spec);
  const startId = screenFlowStartId(spec);
  const missing =
    nested && measured ? screenFlowMissingArtboards(spec, mountedIds) : [];

  const laidOut = boxes.some((box) => box.w >= 1 && box.h >= 1);
  const allFrames = boxes.map(artboardBoxAsNode);
  const nodes = allFrames.filter((node) => referenced.has(node.id));
  const extraFrames = allFrames.filter((node) => !referenced.has(node.id));
  const captionObstacles = [...captions.values()].map((cap) =>
    artboardBoxAsNode({
      h: cap.h,
      id: `cap_${cap.id}`,
      w: cap.w,
      x: cap.x,
      y: cap.y,
    })
  );
  const worldWidth = Math.max(
    planeSize.width,
    ...allFrames.map((node) => node.x + node.w),
    1
  );
  const compiled =
    nested &&
    directChild &&
    structure.status === 0 &&
    missing.length === 0 &&
    laidOut
      ? compileWorkflowEdges({
          edges: spec.edges,
          groups: [],
          lanes: [],
          mainPath: spec.mainPath,
          nodes: [...nodes, ...extraFrames, ...captionObstacles],
          width: worldWidth,
        })
      : null;
  const geometry = compiled
    ? [
        ...rewriteScreenFlowFixes(
          compiled.diagnostics.filter((item) => item.severity === "error")
        ),
        ...screenFlowPlacementDiagnostics(allFrames),
      ]
    : [];
  const blocking = [
    ...(nested && directChild
      ? []
      : [
          {
            message: "ScreenFlow must be a direct child of WorldStage.",
            supportedFixes: [
              "Move ScreenFlow next to the Layer children, not inside a Layer.",
            ],
          },
        ]),
    ...structure.diagnostics,
    ...missing,
    ...geometry,
  ];
  const invalid = blocking.length > 0;

  const layout =
    compiled && geometry.length === 0
      ? paintLayout({
          edges: compiled.edges,
          height: Math.max(planeSize.height, 1),
          nodes: [...nodes, ...captionObstacles],
          title: spec.title,
          width: Math.max(planeSize.width, 1),
        })
      : null;
  const highlight = workflowHighlight(spec, hover);
  const active = workflowHighlightActive(highlight);
  const hasLayout = layout !== null;
  const hotKey = [...highlight.nodes].toSorted().join(",");

  useLayoutEffect(() => {
    const overlay = overlayRef.current;
    const plane = overlay?.closest("[data-canvas-stage='world']");
    if (!(plane instanceof HTMLElement)) {
      return;
    }
    const onOver = (event: Event) => {
      const next = workflowHoverFromTarget(event.target);
      const resolved =
        next?.kind === "node" && !referenced.has(next.id) ? null : next;
      setHover((prev) => {
        if (prev?.kind === resolved?.kind && prev?.id === resolved?.id) {
          return prev;
        }
        return resolved;
      });
    };
    const onLeave = () => {
      setHover(null);
    };
    plane.addEventListener("pointerover", onOver);
    plane.addEventListener("pointerleave", onLeave);
    return () => {
      plane.removeEventListener("pointerover", onOver);
      plane.removeEventListener("pointerleave", onLeave);
    };
  }, [referenced]);

  useLayoutEffect(() => {
    const overlay = overlayRef.current;
    const plane = overlay?.closest("[data-canvas-stage='world']");
    if (!(plane instanceof HTMLElement)) {
      return;
    }
    for (const el of plane.querySelectorAll("[data-artboard-id]")) {
      if (!(el instanceof HTMLElement)) {
        continue;
      }
      const id = el.dataset.artboardId;
      if (!(id && referenced.has(id)) || invalid || !hasLayout) {
        el.removeAttribute("data-screen-flow-state");
        el.removeAttribute("data-screen-flow-start");
        continue;
      }
      const hot = active && hotKey.split(",").includes(id);
      el.setAttribute("data-screen-flow-state", hot ? "hot" : "idle");
      if (id === startId) {
        el.setAttribute("data-screen-flow-start", spec.title);
      } else {
        el.removeAttribute("data-screen-flow-start");
      }
    }
    return () => {
      for (const el of plane.querySelectorAll("[data-artboard-id]")) {
        if (el instanceof HTMLElement) {
          el.removeAttribute("data-screen-flow-state");
          el.removeAttribute("data-screen-flow-start");
        }
      }
    };
  }, [active, hasLayout, hotKey, invalid, referenced, spec.title, startId]);

  const startCaption = startId ? captions.get(startId) : undefined;
  const overlayClass = cn("pointer-events-none absolute inset-0", className);

  if (!nested) {
    return (
      <div className={className} data-screen-flow="invalid" ref={overlayRef}>
        <EmptyCard diagnostics={blocking} />
      </div>
    );
  }

  return (
    <div className={overlayClass} data-slot="screen-flow" ref={overlayRef}>
      {invalid ? (
        <div className="pointer-events-auto absolute top-4 left-4 max-w-md">
          <EmptyCard diagnostics={blocking} />
        </div>
      ) : null}
      {layout && !invalid ? (
        <>
          <WorkflowOverlaySvg
            height={layout.height}
            slot="screen-flow-ink"
            width={layout.width}
            zIndex={0}
          >
            <WorkflowEdgeStrokes
              active={active}
              highlight={highlight}
              kind="screens"
              layout={layout}
              onHover={setHover}
            />
            <WorkflowEdgeArrows
              active={active}
              highlight={highlight}
              kind="screens"
              layout={layout}
              onHover={setHover}
            />
          </WorkflowOverlaySvg>
          <WorkflowOverlaySvg
            height={layout.height}
            slot="screen-flow-labels"
            width={layout.width}
            zIndex={2}
          >
            <WorkflowEdgeLabels
              active={active}
              highlight={highlight}
              kind="screens"
              layout={layout}
              onHover={setHover}
            />
          </WorkflowOverlaySvg>
        </>
      ) : null}
      {layout && !invalid && startCaption ? (
        <div
          data-slot="screen-flow-start"
          style={{
            left: startCaption.x,
            top: Math.max(0, startCaption.y - 28),
            zIndex: 2,
          }}
        >
          {spec.title}
        </div>
      ) : null}
    </div>
  );
}
