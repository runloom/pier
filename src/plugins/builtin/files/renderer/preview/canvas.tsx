import {
  COMMENT_NAVIGATOR_SCROLL_PAD_CLASS,
  CommentNavigator,
} from "@pier/ui/comments/navigator.tsx";
import { cn } from "@pier/ui/utils.ts";
import type { RendererPluginContext } from "@plugins/api/renderer.ts";
import { findCanvasCommentAnchorElement } from "@shared/comments/canvas-anchor.ts";
import {
  detectProjectCanvasFramework,
  liveModuleProjectContentDirectories,
  normalizeProjectRootKey,
  projectCanvasLocation,
} from "@shared/live-module-canvas-path.ts";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import {
  useCommentNavigatorController,
  useCommentNavigatorLabels,
} from "../comments/use-comment-navigator.ts";
import type { FilesTranslate } from "../i18n.ts";
import {
  clearCanvasBusy,
  markCanvasActive,
  requestCanvasReload,
  unmarkCanvasActive,
  useCanvasChrome,
} from "./canvas-chrome-store.ts";
import { CanvasCommentOverlay } from "./canvas-comment-overlay.tsx";
import type { CanvasCommentPinView } from "./canvas-comment-pins.tsx";
import { createCanvasCommentLabels } from "./canvas-comments-button.tsx";
import {
  clearCanvasCommentsSession,
  publishCanvasCommentsSession,
} from "./canvas-comments-session.ts";
import {
  type CanvasPreviewState,
  useCanvasCompileSession,
} from "./canvas-compile-session.ts";
import {
  CanvasCompileErrorEmpty,
  CanvasLoadingSkeleton,
  CanvasSoftErrorBanner,
  CanvasUnavailableEmpty,
  clearMountedCanvas,
} from "./canvas-states.tsx";
import { subscribeLiveModulesProjectConfigChanged } from "./load-live-modules-config.ts";
import { useCanvasCommentPins } from "./use-canvas-comment-pins.ts";
import { useCanvasExternalLinks } from "./use-canvas-external-links.ts";
import {
  CANVAS_PICK_DRAFT_ID,
  type CanvasCommentThreadView,
  useCanvasHostAnchorIds,
  useCanvasPreviewComments,
} from "./use-canvas-preview-comments.ts";

interface CanvasCommentNavTarget {
  readonly commentId: string;
  /** Non-null only for in-preview pin-backed targets (floating n/N reveal). */
  readonly pinKey: string | null;
  readonly threadId: string;
}

/** Floating nav cycle: only threads that have a live pin (reveal can open). */
function buildCanvasCommentNavTargets(
  pins: readonly CanvasCommentPinView[]
): CanvasCommentNavTarget[] {
  const targets: CanvasCommentNavTarget[] = [];
  const seen = new Set<string>();
  for (const pin of pins) {
    for (const thread of pin.threads) {
      if (seen.has(thread.threadId)) {
        continue;
      }
      seen.add(thread.threadId);
      targets.push({
        commentId: thread.comment.id,
        pinKey: pin.key,
        threadId: thread.threadId,
      });
    }
  }
  return targets;
}

/**
 * Clear-all set: every live comment on this canvas path (pins + file + drift +
 * unlocated picks). Must match status-bar processable coverage for the file.
 */
function buildCanvasCommentClearTargets(input: {
  readonly driftNodeThreads: readonly CanvasCommentThreadView[];
  readonly fileThreads: readonly CanvasCommentThreadView[];
  readonly locateDriftThreads: readonly CanvasCommentThreadView[];
  readonly pickedNodeThreads: readonly CanvasCommentThreadView[];
  readonly pins: readonly CanvasCommentPinView[];
}): CanvasCommentNavTarget[] {
  const targets: CanvasCommentNavTarget[] = [];
  const seen = new Set<string>();
  const push = (thread: CanvasCommentThreadView, pinKey: string | null) => {
    if (seen.has(thread.threadId)) {
      return;
    }
    seen.add(thread.threadId);
    targets.push({
      commentId: thread.comment.id,
      pinKey,
      threadId: thread.threadId,
    });
  };
  for (const pin of input.pins) {
    for (const thread of pin.threads) {
      push(thread, pin.key);
    }
  }
  for (const thread of [
    ...input.fileThreads,
    ...input.driftNodeThreads,
    ...input.pickedNodeThreads,
    ...input.locateDriftThreads,
  ]) {
    push(thread, null);
  }
  return targets;
}

/**
 * Live Modules preview inside the files panel (same shell as Markdown preview).
 */
export function FileCanvasPreview(props: {
  context: RendererPluginContext;
  path: string;
  root: string;
  t: FilesTranslate;
  worktreeKey?: string | undefined;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const shellRef = useRef<HTMLDivElement | null>(null);
  /** Relative box for comment overlay geometry (not the preview scroll root). */
  const [canvasShellEl, setCanvasShellEl] = useState<HTMLDivElement | null>(
    null
  );
  const unmountRef = useRef<(() => void) | null>(null);
  const mountedIdentityRef = useRef<string | null>(null);
  const mountedModuleIdRef = useRef<string | null>(null);
  const [nonce, setNonce] = useState(0);
  const [state, setState] = useState<CanvasPreviewState>({ kind: "pending" });
  const [configEpoch, setConfigEpoch] = useState(0);
  const [hostEl, setHostEl] = useState<HTMLDivElement | null>(null);

  useEffect(() => {
    const rootKey = normalizeProjectRootKey(props.root);
    return subscribeLiveModulesProjectConfigChanged((changedRoot) => {
      if (normalizeProjectRootKey(changedRoot) !== rootKey) {
        return;
      }
      setConfigEpoch((value) => value + 1);
    });
  }, [props.root]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: configEpoch invalidates runtime map
  const contentDirectories = useMemo(
    () => liveModuleProjectContentDirectories(props.root),
    [props.root, configEpoch]
  );
  const canvasLocation = projectCanvasLocation(props.path, contentDirectories);
  const relPath = canvasLocation?.relPath ?? null;
  const framework =
    detectProjectCanvasFramework(props.path, contentDirectories) ?? "react";

  useEffect(
    () => () => {
      clearMountedCanvas(
        hostRef.current,
        unmountRef,
        mountedIdentityRef,
        mountedModuleIdRef.current
      );
      mountedModuleIdRef.current = null;
    },
    []
  );

  useCanvasCompileSession({
    context: props.context,
    hostRef,
    mountedIdentityRef,
    mountedModuleIdRef,
    nonce,
    path: props.path,
    root: props.root,
    setNonce,
    setState,
    t: props.t,
    unmountRef,
  });

  useEffect(() => {
    if (!relPath) {
      return;
    }
    markCanvasActive(relPath);
    return () => {
      unmarkCanvasActive(relPath);
    };
  }, [relPath]);

  const chrome = useCanvasChrome(relPath ?? "");
  const lastReloadRef = useRef<number | null>(null);
  /** True while a user-triggered Reload is in flight (toolbar busy → spin). */
  const userReloadPendingRef = useRef(false);
  useEffect(() => {
    if (lastReloadRef.current === null) {
      lastReloadRef.current = chrome.reloadRequest;
      return;
    }
    if (chrome.reloadRequest > lastReloadRef.current) {
      lastReloadRef.current = chrome.reloadRequest;
      userReloadPendingRef.current = true;
      setNonce((value) => value + 1);
    }
  }, [chrome.reloadRequest]);

  // Clear the toolbar busy state once the reload-triggered generation settles
  // on a terminal state. Auto (stale) recompiles never set busy.
  useEffect(() => {
    if (!(relPath && userReloadPendingRef.current)) {
      return;
    }
    if (state.kind !== "ready" && state.kind !== "error") {
      return;
    }
    userReloadPendingRef.current = false;
    clearCanvasBusy(relPath);
  }, [relPath, state]);

  // Host element for anchor scan (ready + host mounted after compile).
  // biome-ignore lint/correctness/useExhaustiveDependencies: rebind when canvas remounts
  useEffect(() => {
    setHostEl(hostRef.current);
  }, [state.kind, nonce]);

  const anchorIds = useCanvasHostAnchorIds(hostEl);
  const worktreeKey = props.worktreeKey ?? props.root;
  const labels = useMemo(() => createCanvasCommentLabels(props.t), [props.t]);
  const comments = useCanvasPreviewComments({
    anchorIds,
    context: props.context,
    labels,
    path: props.path,
    worktreeKey,
  });

  useEffect(() => {
    publishCanvasCommentsSession(props.path, comments);
    return () => {
      clearCanvasCommentsSession(props.path);
    };
  }, [comments, props.path]);

  // Pins only in-preview; unlocated still clearable / status-bar processable.
  const { driftThreads: locateDriftThreads, pins } = useCanvasCommentPins({
    host: hostEl,
    locatedByAnchorId: comments.locatedByAnchorId,
    pickedNodeThreads: comments.pickedNodeThreads,
    shell: canvasShellEl,
    softMarkers: comments.softMarkers,
  });

  const [navOpenPinKey, setNavOpenPinKey] = useState<string | null>(null);
  // Floating n/N is pin-centric (every step has a reveal). Clear covers full path.
  const navTargets = useMemo(() => buildCanvasCommentNavTargets(pins), [pins]);
  const clearTargets = useMemo(
    () =>
      buildCanvasCommentClearTargets({
        driftNodeThreads: comments.driftNodeThreads,
        fileThreads: comments.fileThreads,
        locateDriftThreads,
        pickedNodeThreads: comments.pickedNodeThreads,
        pins,
      }),
    [
      comments.driftNodeThreads,
      comments.fileThreads,
      comments.pickedNodeThreads,
      locateDriftThreads,
      pins,
    ]
  );
  const navLabels = useCommentNavigatorLabels(props.t);
  const onRevealNavTarget = useCallback(
    (target: CanvasCommentNavTarget) => {
      if (target.pinKey === null) {
        return;
      }
      const pin = pins.find((entry) => entry.key === target.pinKey);
      if (!pin) {
        return;
      }
      const shell = canvasShellEl ?? shellRef.current;
      const pinEl =
        shell?.querySelector(`[data-canvas-comment-pin="${pin.index}"]`) ??
        null;
      if (pinEl instanceof HTMLElement) {
        pinEl.scrollIntoView({ block: "center", behavior: "smooth" });
      }
      comments.setPickMode(false);
      setNavOpenPinKey(target.pinKey);
    },
    [canvasShellEl, comments, pins]
  );
  const commentNavigator = useCommentNavigatorController({
    clearTargets,
    context: props.context,
    labels: navLabels,
    onReveal: onRevealNavTarget,
    targets: navTargets,
    worktreeKey,
  });

  // Esc exits Design Mode pick (layer handles click/hover via elementFromPoint).
  useEffect(() => {
    if (!comments.pickMode) {
      return;
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        if (comments.draftOpen) {
          comments.handlers.onCancelDraft(CANVAS_PICK_DRAFT_ID);
          return;
        }
        comments.setPickMode(false);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [
    comments.draftOpen,
    comments.handlers,
    comments.pickMode,
    comments.setPickMode,
  ]);

  // Reveal: scroll to anchor when panel params request it.
  const revealAnchor = useCanvasRevealAnchor(props.path);
  useEffect(() => {
    if (!(revealAnchor && hostEl && state.kind === "ready")) {
      return;
    }
    const el = findCanvasCommentAnchorElement(hostEl, revealAnchor);
    el?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [hostEl, revealAnchor, state.kind]);

  useCanvasExternalLinks({
    context: props.context,
    enabled: state.kind === "ready",
    hostRef,
    t: props.t,
  });
  if (!relPath) {
    return <CanvasUnavailableEmpty t={props.t} />;
  }

  const reload = () => {
    requestCanvasReload(relPath);
  };
  const showHost = state.kind === "pending" || state.kind === "ready";
  const isBusy = state.kind === "pending" || state.kind === "loading";
  const softError = state.kind === "ready" ? state.softError : undefined;

  return (
    <div
      aria-busy={isBusy ? true : undefined}
      className="relative flex min-h-0 flex-1 flex-col overflow-hidden bg-background"
      data-framework={framework}
      data-pick-mode={comments.pickMode ? "" : undefined}
      data-slot="file-canvas-preview"
    >
      <div
        className={cn(
          "min-h-0 flex-1 overflow-auto",
          commentNavigator.visible && COMMENT_NAVIGATOR_SCROLL_PAD_CLASS
        )}
        data-slot="file-canvas-scroll"
        ref={shellRef}
      >
        {softError ? (
          <CanvasSoftErrorBanner
            message={softError.message}
            onReload={reload}
            t={props.t}
          />
        ) : null}

        {state.kind === "error" ? (
          <CanvasCompileErrorEmpty
            diagnostics={state.diagnostics}
            isRuntime={state.isRuntime}
            message={state.message}
            onReload={reload}
            t={props.t}
          />
        ) : null}

        {state.kind === "loading" ? (
          <CanvasLoadingSkeleton
            label={props.t("filePanel.canvas.compiling", "Compiling canvas…")}
          />
        ) : null}

        <div
          className={cn(
            "relative mx-auto min-h-full w-full max-w-5xl px-6 py-5",
            !showHost && "hidden"
          )}
          data-pier-canvas-shell=""
          ref={setCanvasShellEl}
        >
          <div className="relative min-h-full w-full" ref={hostRef} />
          {showHost ? (
            <CanvasCommentOverlay
              draftOpen={comments.draftOpen}
              draftPick={comments.draftPick}
              draftPlacement={comments.draftPlacement}
              handlers={comments.handlers}
              host={hostEl}
              labels={labels}
              onExitPickMode={() => {
                comments.setPickMode(false);
              }}
              onPickElement={comments.openPickDraft}
              onRequestOpenConsumed={() => {
                setNavOpenPinKey(null);
              }}
              pickMode={comments.pickMode}
              pins={pins}
              requestOpenKey={navOpenPinKey}
              shell={canvasShellEl}
            />
          ) : null}
        </div>
      </div>
      {commentNavigator.visible ? (
        <CommentNavigator
          activeIndex={commentNavigator.activeIndex}
          clearLabel={commentNavigator.clearLabel}
          nextLabel={commentNavigator.nextLabel}
          onClear={commentNavigator.onClear}
          onNext={commentNavigator.onNext}
          onPrevious={commentNavigator.onPrevious}
          positionLabel={commentNavigator.positionLabel}
          previousLabel={commentNavigator.previousLabel}
          toolbarLabel={commentNavigator.toolbarLabel}
          total={commentNavigator.total}
        />
      ) : null}
    </div>
  );
}

/** Panel-params reveal bus for canvas anchor scroll. */
const revealByPath = new Map<string, string>();
const revealListeners = new Set<() => void>();

export function requestCanvasAnchorReveal(
  path: string,
  anchorId: string
): void {
  revealByPath.set(path, anchorId);
  for (const listener of revealListeners) {
    listener();
  }
}

function useCanvasRevealAnchor(path: string): string | null {
  return useSyncExternalStore(
    (onStoreChange) => {
      revealListeners.add(onStoreChange);
      return () => {
        revealListeners.delete(onStoreChange);
      };
    },
    () => revealByPath.get(path) ?? null,
    () => null
  );
}
