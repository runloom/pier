/**
 * Comment navigator wiring for the canvas preview shell: n/N targets from
 * live pins, reveal (scroll / hidden-tab hunt) and pin-open focus tracking.
 */
import type { RendererPluginContext } from "@plugins/api/renderer.ts";
import { type RefObject, useCallback, useMemo, useRef, useState } from "react";
import {
  useCommentNavigatorController,
  useCommentNavigatorLabels,
} from "../comments/use-comment-navigator.ts";
import type { FilesTranslate } from "../i18n.ts";
import {
  buildCanvasCommentClearTargets,
  buildCanvasCommentNavTargets,
  type CanvasCommentNavTarget,
  revealCanvasCommentNavTarget,
} from "./canvas-comment-nav.ts";
import { primaryCanvasPinThread } from "./canvas-comment-order.ts";
import type { CanvasCommentPinView } from "./canvas-comment-pins.tsx";
import type { CanvasCommentThreadView } from "./use-canvas-preview-comments.ts";

export function useCanvasCommentNavigation(input: {
  canvasShellEl: HTMLDivElement | null;
  context: RendererPluginContext;
  hiddenPins: readonly CanvasCommentPinView[];
  hostEl: HTMLDivElement | null;
  liveThreads: readonly CanvasCommentThreadView[];
  pins: readonly CanvasCommentPinView[];
  setPickMode: (value: boolean) => void;
  shellRef: RefObject<HTMLDivElement | null>;
  t: FilesTranslate;
  worktreeKey: string;
}) {
  const {
    canvasShellEl,
    context,
    hiddenPins,
    hostEl,
    liveThreads,
    pins,
    setPickMode,
    shellRef,
    t,
    worktreeKey,
  } = input;

  const [navOpenPinKey, setNavOpenPinKey] = useState<string | null>(null);
  const [focusedThreadId, setFocusedThreadId] = useState<string | null>(null);
  const cancelNavScrollRef = useRef<(() => void) | undefined>(undefined);
  const navTargets = useMemo(
    () =>
      buildCanvasCommentNavTargets({
        hiddenPins,
        pins,
      }),
    [hiddenPins, pins]
  );
  const clearTargets = useMemo(
    () => buildCanvasCommentClearTargets(liveThreads),
    [liveThreads]
  );
  const firstVisibleThreadId = useMemo(() => {
    let first = pins[0];
    for (const pin of pins) {
      if (first === undefined || pin.index < first.index) {
        first = pin;
      }
    }
    return primaryCanvasPinThread(first?.threads ?? [])?.threadId ?? null;
  }, [pins]);
  const navLabels = useCommentNavigatorLabels(t);
  const onRevealNavTarget = useCallback(
    (target: CanvasCommentNavTarget) => {
      setPickMode(false);
      setFocusedThreadId(target.threadId);
      cancelNavScrollRef.current?.();
      cancelNavScrollRef.current = revealCanvasCommentNavTarget({
        hiddenPins,
        host: hostEl,
        onOpenPin: setNavOpenPinKey,
        pins,
        shell: canvasShellEl ?? shellRef.current,
        target,
      });
    },
    [canvasShellEl, hiddenPins, hostEl, pins, setPickMode, shellRef]
  );
  const commentNavigator = useCommentNavigatorController({
    clearTargets,
    context,
    labels: navLabels,
    onReveal: onRevealNavTarget,
    selectedThreadId: focusedThreadId ?? firstVisibleThreadId,
    targets: navTargets,
    worktreeKey,
  });

  const onPinOpen = useCallback((pin: CanvasCommentPinView) => {
    const thread = primaryCanvasPinThread(pin.threads);
    if (thread) {
      setFocusedThreadId(thread.threadId);
    }
  }, []);
  const onRequestOpenConsumed = useCallback(() => {
    setNavOpenPinKey(null);
  }, []);

  return { commentNavigator, navOpenPinKey, onPinOpen, onRequestOpenConsumed };
}
