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
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import type { FilesTranslate } from "../i18n.ts";
import {
  markCanvasActive,
  setCanvasBusy,
  unmarkCanvasActive,
  useCanvasChrome,
} from "./canvas-chrome-store.ts";
import { CanvasCommentOverlay } from "./canvas-comment-overlay.tsx";
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
  clearCanvasPickHighlight,
  resolveCanvasElementPick,
  setCanvasPickHighlight,
} from "./canvas-element-pick.ts";
import {
  CanvasCompileErrorEmpty,
  CanvasLoadingSkeleton,
  CanvasSoftErrorBanner,
  CanvasUnavailableEmpty,
  clearMountedCanvas,
} from "./canvas-states.tsx";
import { subscribeLiveModulesProjectConfigChanged } from "./load-live-modules-config.ts";
import {
  useCanvasHostAnchorIds,
  useCanvasPreviewComments,
} from "./use-canvas-preview-comments.ts";

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
  useEffect(() => {
    if (lastReloadRef.current === null) {
      lastReloadRef.current = chrome.reloadRequest;
      return;
    }
    if (chrome.reloadRequest > lastReloadRef.current) {
      lastReloadRef.current = chrome.reloadRequest;
      setNonce((value) => value + 1);
    }
  }, [chrome.reloadRequest]);

  useEffect(() => {
    if (!relPath) {
      return;
    }
    setCanvasBusy(
      relPath,
      state.kind === "pending" || state.kind === "loading"
    );
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

  // Design Mode: capture click/hover on live host to annotate; Esc exits.
  useEffect(() => {
    if (!(comments.pickMode && hostEl && state.kind === "ready")) {
      if (hostEl) {
        clearCanvasPickHighlight(hostEl);
      }
      return;
    }
    const onMove = (event: MouseEvent) => {
      const pick = resolveCanvasElementPick(hostEl, event);
      if (!pick) {
        clearCanvasPickHighlight(hostEl);
        return;
      }
      // Re-resolve the element for highlight (pick is a snapshot).
      let current: Element | null =
        event.target instanceof Element ? event.target : null;
      let highlight: HTMLElement | null = null;
      while (current && current !== hostEl) {
        if (current instanceof HTMLElement) {
          highlight = current;
          if (current.getAttribute("data-pier-comment-id")?.trim()) {
            break;
          }
        }
        current = current.parentElement;
      }
      setCanvasPickHighlight(hostEl, highlight);
    };
    const onLeave = () => {
      clearCanvasPickHighlight(hostEl);
    };
    const onClick = (event: MouseEvent) => {
      if (comments.draftOpen) {
        return;
      }
      const pick = resolveCanvasElementPick(hostEl, event);
      if (!pick) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      clearCanvasPickHighlight(hostEl);
      comments.openPickDraft(pick);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        comments.setPickMode(false);
      }
    };
    hostEl.addEventListener("mousemove", onMove, { passive: true });
    hostEl.addEventListener("mouseleave", onLeave);
    hostEl.addEventListener("click", onClick, true);
    window.addEventListener("keydown", onKeyDown);
    hostEl.style.cursor = "crosshair";
    return () => {
      hostEl.removeEventListener("mousemove", onMove);
      hostEl.removeEventListener("mouseleave", onLeave);
      hostEl.removeEventListener("click", onClick, true);
      window.removeEventListener("keydown", onKeyDown);
      hostEl.style.cursor = "";
      clearCanvasPickHighlight(hostEl);
    };
  }, [
    comments.draftOpen,
    comments.openPickDraft,
    comments.pickMode,
    comments.setPickMode,
    hostEl,
    state.kind,
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

  if (!relPath) {
    return <CanvasUnavailableEmpty t={props.t} />;
  }

  const reload = () => {
    setNonce((value) => value + 1);
  };
  const showHost = state.kind === "pending" || state.kind === "ready";
  const isBusy = state.kind === "pending" || state.kind === "loading";
  const softError = state.kind === "ready" ? state.softError : undefined;

  return (
    <div
      aria-busy={isBusy ? true : undefined}
      className="relative flex min-h-0 flex-1 flex-col overflow-auto bg-background"
      data-framework={framework}
      data-pick-mode={comments.pickMode ? "" : undefined}
      data-slot="file-canvas-preview"
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
      >
        <div className="min-h-full w-full" ref={hostRef} />
        {showHost ? (
          <CanvasCommentOverlay
            draftOpen={comments.draftOpen}
            draftPick={comments.draftPick}
            handlers={comments.handlers}
            host={hostEl}
            labels={labels}
            locatedByAnchorId={comments.locatedByAnchorId}
            pickMode={comments.pickMode}
            shell={shellRef.current}
          />
        ) : null}
      </div>
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
