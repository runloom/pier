import { Button } from "@pier/ui/button.tsx";
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
} from "./floating-geometry.ts";
import { TerminalFloatingStaticItem } from "./floating-static-item.tsx";
import { useTerminalPanelFloatingDrag } from "./hooks/use-panel-floating-drag.ts";
import { TERMINAL_STATUS_BAR_HEIGHT_PX } from "./status-bar.tsx";

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

/** 返回值加在 right/top 锚点上：右移减小 right，左移增大 right。 */
function keyboardDelta(
  key: string,
  step: number
): readonly [number, number] | null {
  switch (key) {
    case "ArrowDown":
      return [0, step];
    case "ArrowLeft":
      return [step, 0];
    case "ArrowRight":
      return [-step, 0];
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
  // 单一胶囊节点：定位 / 测宽 / hit-test / 绘制同一元素。
  const pillRef = useRef<HTMLDivElement | null>(null);
  // point.x = CSS right（距右缘）；默认 SAFE_INSET 即贴右上内侧，不会溢出右缘。
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
  const pillCallbackRef = useCallback(
    (element: HTMLDivElement | null) => {
      pillRef.current = element;
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

  const measureItemRect = useCallback(
    (root: HTMLElement): FloatingRect | null => {
      const target = pillRef.current;
      return target ? localRect(target, root) : null;
    },
    []
  );

  const constrainedPoint = useCallback(
    (desired: FloatingPoint): FloatingPoint => {
      const root = panelRootRef.current;
      if (!root) {
        return desired;
      }
      const rootRect = root.getBoundingClientRect();
      const itemRect = measureItemRect(root);
      if (!itemRect) {
        return desired;
      }
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
    [measureItemRect, obstacles, panelRootRef]
  );

  const restoreFromNormalized = useCallback(() => {
    const root = panelRootRef.current;
    if (!root) {
      return;
    }
    const rootRect = root.getBoundingClientRect();
    const itemRect = measureItemRect(root);
    if (!itemRect) {
      return;
    }
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
  }, [constrainedPoint, measureItemRect, panelRootRef, setPoint]);

  const commitPoint = useCallback(
    (next: FloatingPoint) => {
      const root = panelRootRef.current;
      if (!root) {
        return;
      }
      const rootRect = root.getBoundingClientRect();
      const itemRect = measureItemRect(root);
      if (!itemRect) {
        return;
      }
      const position = normalizedPositionFromPoint(
        next,
        {
          bottomReserved: TERMINAL_STATUS_BAR_HEIGHT_PX,
          height: rootRect.height,
          inset: SAFE_INSET,
          width: rootRect.width,
        },
        itemRect
      );
      normalizedRef.current = position;
      onPositionCommit(id, position);
    },
    [id, measureItemRect, onPositionCommit, panelRootRef]
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

  // 拖拽中禁止位置恢复（避免指针下胶囊被弹回）。空闲时面板/胶囊/障碍物
  // 尺寸变化时按归一化位置还原（内容变宽时仍钳制左缘）。
  const restoreIfIdle = useCallback(() => {
    if (drag.dragActiveRef.current) {
      return;
    }
    restoreFromNormalized();
  }, [drag.dragActiveRef, restoreFromNormalized]);

  useLayoutEffect(() => {
    normalizedRef.current =
      layout.positions[id] ?? DEFAULT_PANEL_FLOATING_POSITION;
    restoreIfIdle();
  }, [id, layout.positions, restoreIfIdle]);

  useLayoutEffect(() => {
    if (layoutRevision > 0) {
      restoreIfIdle();
    }
  }, [layoutRevision, restoreIfIdle]);

  useLayoutEffect(() => {
    overlay.flush();
  });

  useLayoutEffect(() => {
    const root = panelRootRef.current;
    const pill = pillRef.current;
    if (!root) {
      return;
    }
    const observer = new ResizeObserver(restoreIfIdle);
    observer.observe(root);
    // 胶囊自身变宽（时长/进度文案）也要 re-clamp；拖拽中 restoreIfIdle 会 no-op。
    if (pill) {
      observer.observe(pill);
    }
    for (const obstacle of obstacles) {
      observer.observe(obstacle);
    }
    restoreIfIdle();
    return () => observer.disconnect();
  }, [obstacles, panelRootRef, restoreIfIdle]);

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
      // 单节点胶囊：内容定宽。禁止任何 % 宽度（max-w-full / w-full / 100%）：
      // absolute 包含块是整面板时，% 会把胶囊撑成整行，右侧留空或像细条。
      className={
        "pointer-events-auto absolute inline-flex h-9 items-center rounded-full border border-border bg-popover text-popover-foreground shadow-background/40 shadow-lg transition-[opacity,transform,box-shadow] duration-[180ms] ease-in data-[phase=exiting]:pointer-events-none data-[phase=exiting]:-translate-y-1 data-[phase=exiting]:scale-[0.985] data-[phase=exiting]:opacity-0 data-[dragging=true]:shadow-xl motion-reduce:transition-none"
      }
      data-dragging={drag.dragging ? "true" : "false"}
      data-floating-item={id}
      data-floating-pill={id}
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
      ref={pillCallbackRef}
      style={{
        // 终端浮层位于透明 Chromium WebContentsView 与原生 Metal 终端表面的
        // 合成边界上。三维位移会把整个胶囊提升为独立 GPU 合成层，macOS 在
        // 悬停或局部重绘时可能保留旧层像素，形成跨位置残影。这里用普通
        // 绝对定位偏移量驱动同一套面板局部几何，避免强制创建合成层。
        // right 锚定：内容变宽向左伸；left:auto 禁止被 left-0 类或默认值钉死。
        // 只靠内容 intrinsic 定宽（禁止 % 宽）；面板内钳制由 geometry 负责。
        left: "auto",
        right: point.x,
        top: point.y,
        width: "max-content",
      }}
    >
      <div className="flex shrink-0 items-center pl-1">
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
      {/* 不用 shadcn Separator：其 data-horizontal:w-full 在异常 orientation 下会拉满宽 */}
      <div
        aria-hidden="true"
        className="my-2 w-px shrink-0 self-stretch bg-border"
        data-slot="separator"
      />
      {content}
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
