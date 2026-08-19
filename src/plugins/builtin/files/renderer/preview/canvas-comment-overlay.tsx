/**
 * Canvas 评论叠层：拾取层 + 高亮 + 计数气泡（悬停预览正文，点击进入编辑）+
 * 叠层评论输入。浮动 n/N 导航由 canvas 预览根挂载（与 diff 同构）；本层负责
 * pin 打开请求。
 *
 * Design Mode pick uses document-level capture so selection works even when the
 * local pick layer does not fully cover tall canvas content. Hit resolution
 * (composedPath → elementsFromPoint → geometry) lives in canvas-element-pick.
 */
import type {
  PierInlineReviewHandlers,
  PierInlineReviewLabels,
} from "@pier/ui/diff-view/review/inline-comment-types.ts";
import { cn } from "@pier/ui/utils.ts";
import {
  type ReactNode,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { CanvasCommentDraftCard } from "./canvas-comment-draft.tsx";
import { findPinForCanvasPick } from "./canvas-comment-locate.ts";
import {
  CanvasCommentPinLayer,
  type CanvasCommentPinView,
} from "./canvas-comment-pins.tsx";
import type {
  CanvasElementPick,
  CanvasPickOverlayBox,
} from "./canvas-element-pick.ts";
import {
  clientPointInShell,
  hitCanvasPickChainAtPoint,
  measureCanvasPickBox,
  snapshotCanvasElementPick,
} from "./canvas-element-pick.ts";
import { isCanvasCommentChromePointerEvent } from "./canvas-pick-shared.ts";
import type { CanvasDraftPlacement } from "./use-canvas-preview-comments.ts";

interface HoverPickState {
  readonly box: CanvasPickOverlayBox;
  readonly element: HTMLElement;
  readonly pick: CanvasElementPick;
}

function pointOverElement(
  clientX: number,
  clientY: number,
  el: HTMLElement
): boolean {
  const rect = el.getBoundingClientRect();
  return (
    rect.width > 0 &&
    rect.height > 0 &&
    clientX >= rect.left &&
    clientX < rect.right &&
    clientY >= rect.top &&
    clientY < rect.bottom
  );
}

export function CanvasCommentOverlay(props: {
  readonly draftOpen: boolean;
  readonly draftPick: CanvasElementPick | null;
  readonly draftPlacement: CanvasDraftPlacement | null;
  readonly handlers: PierInlineReviewHandlers;
  readonly host: HTMLElement | null;
  readonly labels: PierInlineReviewLabels;
  /** Exit annotate mode before opening an existing pin. */
  readonly onExitPickMode: () => void;
  readonly onPickElement: (
    pick: CanvasElementPick,
    placement: CanvasDraftPlacement
  ) => void;
  readonly onPinOpen?: (pin: CanvasCommentPinView) => void;
  /** Parent (navigator) may request opening a pin by key. */
  readonly onRequestOpenConsumed?: () => void;
  readonly openInEditMode?: boolean;
  readonly pickMode: boolean;
  readonly pins: readonly CanvasCommentPinView[];
  readonly requestOpenKey?: string | null;
  readonly shell: HTMLElement | null;
}): ReactNode {
  const { draftPlacement, host, onExitPickMode, onPickElement, pins, shell } =
    props;
  const [hover, setHover] = useState<HoverPickState | null>(null);
  const [requestOpenKey, setRequestOpenKey] = useState<string | null>(null);
  const [requestOpenEdit, setRequestOpenEdit] = useState(false);

  // Merge external open requests (comment navigator) with pick-hit opens.
  useEffect(() => {
    if (props.requestOpenKey) {
      setRequestOpenKey(props.requestOpenKey);
      setRequestOpenEdit(props.openInEditMode === true);
      props.onRequestOpenConsumed?.();
    }
  }, [props.onRequestOpenConsumed, props.openInEditMode, props.requestOpenKey]);
  const pickLayerRef = useRef<HTMLDivElement | null>(null);
  const hoverRef = useRef<HoverPickState | null>(null);
  hoverRef.current = hover;

  const showPickDraft = props.draftOpen && props.draftPick !== null;
  const pickActive = props.pickMode && !showPickDraft && host !== null;
  /** Bumps on canvas scroll so pin popovers close (anchor has moved). */
  const [scrollDismissEpoch, setScrollDismissEpoch] = useState(0);

  useEffect(() => {
    if (!pickActive) {
      setHover(null);
    }
  }, [pickActive]);

  // Pin detail is portaled; dismiss it on scroll so the popover does not look
  // stuck. The draft composer is in overlay coordinates and moves with the
  // shell, so drafts stay open.
  useEffect(() => {
    if (!(shell || host)) {
      return;
    }
    const previewRoot =
      shell?.closest("[data-slot='file-canvas-preview']") ??
      shell?.parentElement ??
      null;

    const onScroll = (event: Event) => {
      const target = event.target;
      if (!(target instanceof Element || target instanceof Document)) {
        return;
      }
      const node = target instanceof Document ? target.documentElement : target;
      const insidePreview =
        previewRoot !== null &&
        (node === previewRoot || previewRoot.contains(node));
      const insideHost =
        host !== null && (node === host || host.contains(node));
      if (!(insidePreview || insideHost)) {
        return;
      }
      // Draft composer is in overlay coordinates and moves with the shell.
      // Only dismiss portaled pin popovers whose anchors would look stuck.
      setHover(null);
      setScrollDismissEpoch((value) => value + 1);
    };

    // capture: scroll does not bubble; nested overflow regions must be caught.
    document.addEventListener("scroll", onScroll, {
      capture: true,
      passive: true,
    });
    return () => {
      document.removeEventListener("scroll", onScroll, true);
    };
  }, [host, shell]);

  const resolveHoverAtPoint = useCallback(
    (
      clientX: number,
      clientY: number,
      event?: Event
    ): HoverPickState | null => {
      if (!(host && shell)) {
        return null;
      }
      const chain = hitCanvasPickChainAtPoint(
        host,
        clientX,
        clientY,
        pickLayerRef.current,
        event
      );
      if (!chain) {
        return null;
      }
      const element = chain.chain[chain.defaultDepth] ?? chain.leaf;
      if (!element) {
        return null;
      }
      return {
        box: measureCanvasPickBox(element, shell),
        element,
        pick: snapshotCanvasElementPick(host, element, chain.chain),
      };
    },
    [host, shell]
  );

  const resolvePickClick = useCallback(
    (
      element: HTMLElement,
      pick: CanvasElementPick,
      box: CanvasPickOverlayBox,
      clientX: number,
      clientY: number
    ) => {
      if (!(host && shell)) {
        return;
      }
      const existing = findPinForCanvasPick(host, pick, element, pins);
      if (existing) {
        setRequestOpenKey(existing.key);
        setRequestOpenEdit(true);
        props.onPinOpen?.(existing);
        onExitPickMode();
        setHover(null);
        return;
      }
      const origin = clientPointInShell(shell, clientX, clientY);
      onPickElement(pick, {
        height: box.height,
        left: box.left,
        originX: origin.x,
        originY: origin.y,
        top: box.top,
        width: box.width,
      });
      setHover(null);
    },
    [host, onExitPickMode, onPickElement, pins, props.onPinOpen, shell]
  );

  // Document capture: works even if the absolute pick layer does not cover a
  // tall canvas region (primary fix for "visible but unselectable" cards).
  useEffect(() => {
    if (!(pickActive && host && shell)) {
      return;
    }

    const overCanvas = (clientX: number, clientY: number): boolean =>
      pointOverElement(clientX, clientY, host) ||
      pointOverElement(clientX, clientY, shell);

    // Throttle hover resolve to one geometry walk per frame (large canvases).
    let rafId = 0;
    let pending: {
      clientX: number;
      clientY: number;
      event: PointerEvent;
    } | null = null;
    const flushHover = () => {
      rafId = 0;
      const next = pending;
      pending = null;
      if (!next) {
        return;
      }
      if (!overCanvas(next.clientX, next.clientY)) {
        setHover(null);
        return;
      }
      setHover(resolveHoverAtPoint(next.clientX, next.clientY, next.event));
    };

    const onPointerMove = (event: PointerEvent) => {
      if (isCanvasCommentChromePointerEvent(event)) {
        if (rafId !== 0) {
          window.cancelAnimationFrame(rafId);
          rafId = 0;
        }
        pending = null;
        setHover(null);
        return;
      }
      pending = {
        clientX: event.clientX,
        clientY: event.clientY,
        event,
      };
      if (rafId === 0) {
        rafId = window.requestAnimationFrame(flushHover);
      }
    };

    const onPointerDown = (event: PointerEvent) => {
      if (event.button !== 0) {
        return;
      }
      if (isCanvasCommentChromePointerEvent(event)) {
        return;
      }
      if (!overCanvas(event.clientX, event.clientY)) {
        return;
      }
      // Flush pending hover so click uses the latest point (not a stale rAF).
      if (rafId !== 0) {
        window.cancelAnimationFrame(rafId);
        rafId = 0;
      }
      pending = null;
      // Block canvas UI (tabs, buttons) while annotating.
      event.preventDefault();
      event.stopPropagation();
      const current =
        hoverRef.current ??
        resolveHoverAtPoint(event.clientX, event.clientY, event);
      if (!current) {
        return;
      }
      resolvePickClick(
        current.element,
        current.pick,
        current.box,
        event.clientX,
        event.clientY
      );
    };

    const onPointerLeaveWindow = () => {
      if (rafId !== 0) {
        window.cancelAnimationFrame(rafId);
        rafId = 0;
      }
      pending = null;
      setHover(null);
    };

    window.addEventListener("pointermove", onPointerMove, true);
    window.addEventListener("pointerdown", onPointerDown, true);
    window.addEventListener("blur", onPointerLeaveWindow);
    return () => {
      if (rafId !== 0) {
        window.cancelAnimationFrame(rafId);
      }
      window.removeEventListener("pointermove", onPointerMove, true);
      window.removeEventListener("pointerdown", onPointerDown, true);
      window.removeEventListener("blur", onPointerLeaveWindow);
    };
  }, [host, pickActive, resolveHoverAtPoint, resolvePickClick, shell]);

  return (
    <div
      className="pointer-events-none absolute inset-0 z-10"
      data-slot="canvas-comment-overlay"
    >
      {pickActive ? (
        <div
          aria-hidden
          className="pointer-events-auto absolute inset-0 z-20 cursor-crosshair"
          data-slot="canvas-comment-pick-layer"
          ref={pickLayerRef}
        />
      ) : null}

      {hover && pickActive ? (
        <div
          aria-hidden
          className="pointer-events-none absolute z-20 box-border border border-action-accent"
          data-pier-canvas-pick-box=""
          style={{
            height: Math.max(1, hover.box.height),
            left: hover.box.left,
            top: hover.box.top,
            width: Math.max(1, hover.box.width),
          }}
        >
          <span
            className={cn(
              "absolute left-0 max-w-56 truncate bg-action-accent px-1 py-0.5 font-medium text-[10px] text-action-accent-foreground",
              hover.box.top >= 22 ? "-top-5" : "top-full mt-0.5"
            )}
          >
            {hover.pick.label}
          </span>
        </div>
      ) : null}

      {showPickDraft && draftPlacement ? (
        <div
          aria-hidden
          className="pointer-events-none absolute z-20 box-border border border-action-accent"
          data-pier-canvas-pick-box="draft"
          style={{
            height: Math.max(1, draftPlacement.height),
            left: draftPlacement.left,
            top: draftPlacement.top,
            width: Math.max(1, draftPlacement.width),
          }}
        />
      ) : null}

      <CanvasCommentPinLayer
        handlers={props.handlers}
        interactive={!showPickDraft}
        labels={props.labels}
        onPinOpen={props.onPinOpen}
        onRequestOpenConsumed={() => {
          setRequestOpenKey(null);
          setRequestOpenEdit(false);
        }}
        openInEditMode={requestOpenEdit}
        pins={pins}
        requestOpenKey={requestOpenKey}
        scrollDismissEpoch={scrollDismissEpoch}
      />

      <CanvasCommentDraftCard
        handlers={props.handlers}
        labels={props.labels}
        open={showPickDraft}
        placement={draftPlacement}
      />
    </div>
  );
}
