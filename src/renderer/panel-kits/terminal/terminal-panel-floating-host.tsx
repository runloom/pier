import { Button } from "@pier/ui/button.tsx";
import { Separator } from "@pier/ui/separator.tsx";
import { useTerminalOverlayRegistration } from "@pier/ui/use-terminal-overlay.tsx";
import {
  DEFAULT_PANEL_FLOATING_POSITION,
  type PanelFloatingLayout,
  type PanelFloatingPosition,
} from "@shared/contracts/panel-floating.ts";
import { GripVertical } from "lucide-react";
import {
  type ReactNode,
  type RefObject,
  useCallback,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useT } from "@/i18n/use-t.ts";
import {
  type FloatingPoint,
  type FloatingRect,
  normalizedPositionFromPoint,
  pointFromNormalizedPosition,
  resolveFloatingObstacles,
} from "./terminal-floating-geometry.ts";
import { TerminalFloatingStaticItem } from "./terminal-floating-static-item.tsx";
import { TERMINAL_STATUS_BAR_HEIGHT_PX } from "./terminal-status-bar.tsx";
import { useTerminalPanelFloatingDrag } from "./use-terminal-panel-floating-drag.ts";

const SAFE_INSET = 8;

interface FloatingPrimaryItem {
  content: ReactNode;
  id: string;
  onInteractionChange?(interacting: boolean): void;
  phase?: "exiting" | "visible" | undefined;
}

interface FloatingUtilityItem {
  content: ReactNode;
  id: string;
}

interface TerminalPanelFloatingHostProps {
  layout: PanelFloatingLayout;
  layoutRevision?: number | undefined;
  onPositionCommit(id: string, position: PanelFloatingPosition): void;
  panelId: string;
  panelRootRef: RefObject<HTMLDivElement | null>;
  primary?: FloatingPrimaryItem | undefined;
  utility?: readonly FloatingUtilityItem[] | undefined;
}

function localRect(element: HTMLElement, root: HTMLElement): FloatingRect {
  const rect = element.getBoundingClientRect();
  const rootRect = root.getBoundingClientRect();
  return {
    height: rect.height,
    width: rect.width,
    x: rect.left - rootRect.left,
    y: rect.top - rootRect.top,
  };
}

function keyboardDelta(
  key: string,
  step: number
): readonly [number, number] | null {
  switch (key) {
    case "ArrowDown":
      return [0, step];
    case "ArrowLeft":
      return [-step, 0];
    case "ArrowRight":
      return [step, 0];
    case "ArrowUp":
      return [0, -step];
    default:
      return null;
  }
}

function DraggablePrimaryItem({
  content,
  id,
  layout,
  layoutRevision,
  obstacles,
  onInteractionChange,
  onPositionCommit,
  panelId,
  panelRootRef,
  phase = "visible",
}: FloatingPrimaryItem & {
  layout: PanelFloatingLayout;
  layoutRevision: number;
  obstacles: readonly HTMLElement[];
  onPositionCommit(id: string, position: PanelFloatingPosition): void;
  panelId: string;
  panelRootRef: RefObject<HTMLDivElement | null>;
}) {
  const t = useT();
  const itemRef = useRef<HTMLDivElement | null>(null);
  const pointRef = useRef<FloatingPoint>({ x: SAFE_INSET, y: SAFE_INSET });
  const pointerInsideRef = useRef(false);
  const focusWithinRef = useRef(false);
  const interactingRef = useRef(false);
  const normalizedRef = useRef(
    layout.positions[id] ?? DEFAULT_PANEL_FLOATING_POSITION
  );
  const overlay = useTerminalOverlayRegistration(
    `terminal-floating:${panelId}:${id}`
  );
  const [point, setPointState] = useState(pointRef.current);
  const itemCallbackRef = useCallback(
    (element: HTMLDivElement | null) => {
      itemRef.current = element;
      overlay.ref(element);
    },
    [overlay]
  );
  const reportInteraction = useCallback(() => {
    const interacting = pointerInsideRef.current || focusWithinRef.current;
    if (interacting === interactingRef.current) {
      return;
    }
    interactingRef.current = interacting;
    onInteractionChange?.(interacting);
  }, [onInteractionChange]);

  useLayoutEffect(
    () => () => {
      const wasInteracting = interactingRef.current;
      pointerInsideRef.current = false;
      focusWithinRef.current = false;
      interactingRef.current = false;
      if (wasInteracting) {
        onInteractionChange?.(false);
      }
    },
    [onInteractionChange]
  );

  const setPoint = useCallback((next: FloatingPoint) => {
    pointRef.current = next;
    setPointState(next);
  }, []);

  const constrainedPoint = useCallback(
    (desired: FloatingPoint): FloatingPoint => {
      const root = panelRootRef.current;
      const item = itemRef.current;
      if (!(root && item)) {
        return desired;
      }
      const rootRect = root.getBoundingClientRect();
      const itemRect = localRect(item, root);
      const obstacleRects = obstacles
        .filter((element) => element.isConnected)
        .map((element) => localRect(element, root));
      return resolveFloatingObstacles(
        desired,
        {
          bottomReserved: TERMINAL_STATUS_BAR_HEIGHT_PX,
          height: rootRect.height,
          inset: SAFE_INSET,
          width: rootRect.width,
        },
        itemRect,
        obstacleRects
      );
    },
    [obstacles, panelRootRef]
  );

  const restoreFromNormalized = useCallback(() => {
    const root = panelRootRef.current;
    const item = itemRef.current;
    if (!(root && item)) {
      return;
    }
    const rootRect = root.getBoundingClientRect();
    const itemRect = localRect(item, root);
    setPoint(
      constrainedPoint(
        pointFromNormalizedPosition(
          normalizedRef.current,
          {
            bottomReserved: TERMINAL_STATUS_BAR_HEIGHT_PX,
            height: rootRect.height,
            inset: SAFE_INSET,
            width: rootRect.width,
          },
          itemRect
        )
      )
    );
  }, [constrainedPoint, panelRootRef, setPoint]);

  useLayoutEffect(() => {
    normalizedRef.current =
      layout.positions[id] ?? DEFAULT_PANEL_FLOATING_POSITION;
    restoreFromNormalized();
  }, [id, layout.positions, restoreFromNormalized]);

  useLayoutEffect(() => {
    if (layoutRevision > 0) {
      restoreFromNormalized();
    }
  }, [layoutRevision, restoreFromNormalized]);

  useLayoutEffect(() => {
    overlay.flush();
  });

  useLayoutEffect(() => {
    const root = panelRootRef.current;
    const item = itemRef.current;
    if (!(root && item)) {
      return;
    }
    const observer = new ResizeObserver(restoreFromNormalized);
    observer.observe(root);
    observer.observe(item);
    for (const obstacle of obstacles) {
      observer.observe(obstacle);
    }
    restoreFromNormalized();
    return () => observer.disconnect();
  }, [obstacles, panelRootRef, restoreFromNormalized]);

  const commitPoint = useCallback(
    (next: FloatingPoint) => {
      const root = panelRootRef.current;
      const item = itemRef.current;
      if (!(root && item)) {
        return;
      }
      const rootRect = root.getBoundingClientRect();
      const position = normalizedPositionFromPoint(
        next,
        {
          bottomReserved: TERMINAL_STATUS_BAR_HEIGHT_PX,
          height: rootRect.height,
          inset: SAFE_INSET,
          width: rootRect.width,
        },
        localRect(item, root)
      );
      normalizedRef.current = position;
      onPositionCommit(id, position);
    },
    [id, onPositionCommit, panelRootRef]
  );
  const drag = useTerminalPanelFloatingDrag({
    constrain: constrainedPoint,
    onCancel: restoreFromNormalized,
    onCommit: commitPoint,
    onMove: setPoint,
    panelId,
    panelRootRef,
    pointRef,
  });

  const moveBy = (dx: number, dy: number) => {
    const next = constrainedPoint({
      x: pointRef.current.x + dx,
      y: pointRef.current.y + dy,
    });
    setPoint(next);
    commitPoint(next);
  };

  return (
    <div
      className="@container pointer-events-auto absolute top-0 left-0 data-[phase=exiting]:pointer-events-none"
      data-dragging={drag.dragging ? "true" : "false"}
      data-floating-item={id}
      data-phase={phase}
      onBlurCapture={(event) => {
        if (event.currentTarget.contains(event.relatedTarget as Node | null)) {
          return;
        }
        focusWithinRef.current = false;
        reportInteraction();
      }}
      onFocusCapture={() => {
        focusWithinRef.current = true;
        reportInteraction();
      }}
      onPointerEnter={() => {
        pointerInsideRef.current = true;
        reportInteraction();
      }}
      onPointerLeave={() => {
        pointerInsideRef.current = false;
        reportInteraction();
      }}
      ref={itemCallbackRef}
      style={{
        left: point.x,
        maxWidth: "min(25rem, calc(100% - 1rem))",
        minWidth: "min(20rem, calc(100% - 1rem))",
        // 终端浮层位于透明 Chromium WebContentsView 与原生 Metal 终端表面的
        // 合成边界上。三维位移会把整个胶囊提升为独立 GPU 合成层，macOS 在
        // 悬停或局部重绘时可能保留旧层像素，形成跨位置残影。这里用普通
        // 绝对定位偏移量驱动同一套面板局部几何，避免强制创建合成层。
        // 宽高必须留在 inline style；且外层 fit-content 时内层禁止再套
        // w-full（循环百分比会按面板宽度展开，触发 native overlay 全覆盖藏终端）。
        top: point.y,
        width: "fit-content",
      }}
    >
      <div
        className="flex w-max max-w-full items-stretch overflow-hidden rounded-full border border-border bg-popover text-popover-foreground shadow-background/40 shadow-lg transition-[opacity,transform,box-shadow] duration-[180ms] ease-in data-[phase=exiting]:-translate-y-1 data-[phase=exiting]:scale-[0.985] data-[phase=exiting]:opacity-0 data-[dragging=true]:shadow-xl motion-reduce:transition-none"
        data-dragging={drag.dragging ? "true" : "false"}
        data-phase={phase}
      >
        <div className="flex items-center pl-1">
          <Button
            aria-label={t("terminal.runtimeControl.move")}
            className="cursor-grab touch-none data-[dragging=true]:cursor-grabbing"
            data-dragging={drag.dragging ? "true" : "false"}
            data-testid="terminal-runtime-control-drag-handle"
            onDoubleClick={() => {
              normalizedRef.current = DEFAULT_PANEL_FLOATING_POSITION;
              restoreFromNormalized();
              onPositionCommit(id, DEFAULT_PANEL_FLOATING_POSITION);
            }}
            onKeyDown={(event) => {
              if (event.key === "Home") {
                event.preventDefault();
                normalizedRef.current = DEFAULT_PANEL_FLOATING_POSITION;
                restoreFromNormalized();
                onPositionCommit(id, DEFAULT_PANEL_FLOATING_POSITION);
                return;
              }
              const step = event.shiftKey ? 32 : 8;
              const delta = keyboardDelta(event.key, step);
              if (delta) {
                event.preventDefault();
                moveBy(delta[0], delta[1]);
              }
            }}
            onPointerDown={drag.onPointerDown}
            size="icon-sm"
            title={t("terminal.runtimeControl.move")}
            tone="muted"
            type="button"
            variant="ghost"
          >
            <GripVertical aria-hidden="true" data-icon="inline-start" />
          </Button>
        </div>
        <Separator className="my-2" orientation="vertical" />
        {content}
      </div>
    </div>
  );
}

/**
 * 终端 panel 内唯一浮层宿主：主槽只容纳一个可拖拽运行控制容器，搜索等短时
 * 工具进入右上角工具槽。新增能力应组合进主槽或工具槽，不自行创建悬浮坐标系。
 */
export function TerminalPanelFloatingHost({
  layout,
  layoutRevision = 0,
  onPositionCommit,
  panelId,
  panelRootRef,
  primary,
  utility = [],
}: TerminalPanelFloatingHostProps) {
  const [utilityElements, setUtilityElements] = useState<
    Record<string, HTMLElement>
  >({});
  const setUtilityElement = useCallback(
    (id: string, element: HTMLElement | null) => {
      setUtilityElements((current) => {
        if (element) {
          return current[id] === element
            ? current
            : { ...current, [id]: element };
        }
        if (!current[id]) {
          return current;
        }
        const next = { ...current };
        delete next[id];
        return next;
      });
    },
    []
  );
  const obstacles = useMemo(
    () => Object.values(utilityElements),
    [utilityElements]
  );

  if (!(primary || utility.length > 0)) {
    return null;
  }
  return (
    <div
      className="pointer-events-none absolute inset-0 z-30 overflow-hidden"
      data-testid="terminal-panel-floating-host"
    >
      <div
        className="absolute top-3 right-3 flex max-w-[calc(100%_-_1.5rem)] flex-col items-end gap-2"
        data-floating-slot="utility"
      >
        {utility.map((item) => (
          <TerminalFloatingStaticItem
            id={item.id}
            key={item.id}
            panelId={panelId}
            setElement={setUtilityElement}
          >
            {item.content}
          </TerminalFloatingStaticItem>
        ))}
      </div>
      {primary ? (
        <div data-floating-slot="primary">
          <DraggablePrimaryItem
            key={primary.id}
            {...primary}
            layout={layout}
            layoutRevision={layoutRevision}
            obstacles={obstacles}
            onPositionCommit={onPositionCommit}
            panelId={panelId}
            panelRootRef={panelRootRef}
          />
        </div>
      ) : null}
    </div>
  );
}
