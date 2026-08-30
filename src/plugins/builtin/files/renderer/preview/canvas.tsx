import {
  COMMENT_NAVIGATOR_SCROLL_PAD_CLASS,
  CommentNavigator,
} from "@pier/ui/comments/navigator.tsx";
import { ImagePreviewControls } from "@pier/ui/image-preview/controls.tsx";
import { WorldViewportFrame } from "@pier/ui/image-preview/world-canvas.tsx";
import { cn } from "@pier/ui/utils.ts";
import type { RendererPluginContext } from "@plugins/api/renderer.ts";
import { findCanvasCommentAnchorElement } from "@shared/comments/canvas-anchor.ts";
import type { PanelContext } from "@shared/contracts/panel.ts";
import {
  detectProjectCanvasFramework,
  liveModuleProjectContentDirectories,
  normalizeProjectRootKey,
  projectCanvasLocation,
} from "@shared/live-module-canvas-path.ts";
import { useEffect, useMemo, useRef, useState } from "react";
import type { FilesTranslate } from "../i18n.ts";
import { useCanvasRevealAnchor } from "./canvas-anchor-reveal.ts";
import { CanvasCommentOverlay } from "./canvas-comment-overlay.tsx";
import { createCanvasCommentLabels } from "./canvas-comments-button.tsx";
import {
  clearCanvasCommentsSession,
  publishCanvasCommentsSession,
} from "./canvas-comments-session.ts";
import { useCanvasCompileSession } from "./canvas-compile-session.ts";
import type { CanvasPreviewState } from "./canvas-compile-state.ts";
import { useCanvasPreviewContextMenu } from "./canvas-preview-surface.ts";
import { canvasFlowMeasureClass } from "./canvas-stage.ts";
import {
  CanvasCompileErrorEmpty,
  CanvasLoadingSkeleton,
  CanvasSoftErrorBanner,
  CanvasUnavailableEmpty,
  clearMountedCanvas,
} from "./canvas-states.tsx";
import { subscribeLiveModulesProjectConfigChanged } from "./load-live-modules-config.ts";
import { useCanvasChromeReload } from "./use-canvas-chrome-reload.ts";
import { useCanvasCommentNavigation } from "./use-canvas-comment-navigation.ts";
import { useCanvasCommentPins } from "./use-canvas-comment-pins.ts";
import { useCanvasExternalLinks } from "./use-canvas-external-links.ts";
import {
  CANVAS_PICK_DRAFT_ID,
  useCanvasHostAnchorIds,
  useCanvasPreviewComments,
} from "./use-canvas-preview-comments.ts";
import { useCanvasReadingPrefs } from "./use-canvas-reading-prefs.ts";
import { useCanvasStageViewport } from "./use-canvas-stage-viewport.ts";

/**
 * Live Modules preview inside the files panel (same shell as Markdown preview).
 */
export function FileCanvasPreview(props: {
  context: RendererPluginContext;
  panelContext?: PanelContext | undefined;
  panelId?: string | undefined;
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

  const { reload } = useCanvasChromeReload({ relPath, setNonce, state });

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

  const { camera, stageInfo, stageLabels, worldStage } = useCanvasStageViewport(
    {
      canvasShellEl,
      hostEl,
      nonce,
      path: props.path,
      pickMode: comments.pickMode,
      stateKind: state.kind,
      t: props.t,
    }
  );
  const reading = useCanvasReadingPrefs({
    stageInfo,
    worldActive:
      worldStage && (state.kind === "pending" || state.kind === "ready"),
  });

  useEffect(() => {
    publishCanvasCommentsSession(props.path, comments);
    return () => {
      clearCanvasCommentsSession(props.path);
    };
  }, [comments, props.path]);

  // Visible pins paint; hidden tab pins keep stable n/N + reveal-via-tab-click.
  const { hiddenPins, pins } = useCanvasCommentPins({
    host: hostEl,
    locatedByAnchorId: comments.locatedByAnchorId,
    pickedNodeThreads: comments.pickedNodeThreads,
    shell: canvasShellEl,
    softMarkers: comments.softMarkers,
  });

  const nav = useCanvasCommentNavigation({
    canvasShellEl,
    context: props.context,
    hiddenPins,
    hostEl,
    liveThreads: comments.liveThreads,
    pins,
    setPickMode: comments.setPickMode,
    shellRef,
    t: props.t,
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

  // Reveal: scroll to anchor when panel params request it (flow mode only).
  const revealAnchor = useCanvasRevealAnchor(props.path);
  useEffect(() => {
    if (!(revealAnchor && hostEl && state.kind === "ready" && !worldStage)) {
      return;
    }
    const el = findCanvasCommentAnchorElement(hostEl, revealAnchor);
    el?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [hostEl, revealAnchor, state.kind, worldStage]);

  useCanvasExternalLinks({
    context: props.context,
    enabled: state.kind === "ready",
    hostRef,
    t: props.t,
  });
  const { onContextMenu, previewRootRef } = useCanvasPreviewContextMenu({
    context: props.context,
    panelContext: props.panelContext,
    panelId: props.panelId,
    path: props.path,
    root: props.root,
    t: props.t,
  });
  if (!relPath) {
    return <CanvasUnavailableEmpty t={props.t} />;
  }

  const showHost = state.kind === "pending" || state.kind === "ready";
  const isBusy = state.kind === "pending" || state.kind === "loading";
  const softError = state.kind === "ready" ? state.softError : undefined;
  // Error / trust / loading states always present in the reading flow.
  const worldActive = worldStage && showHost;

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions lint/a11y/noNoninteractiveElementInteractions: canvas preview is a native context-menu surface with no accurate interactive ARIA role
    <div
      aria-busy={isBusy ? true : undefined}
      className="relative flex min-h-0 flex-1 flex-col overflow-hidden bg-background"
      data-framework={framework}
      data-pick-mode={comments.pickMode ? "" : undefined}
      data-slot="file-canvas-preview"
      onContextMenu={onContextMenu}
      ref={previewRootRef}
    >
      <div
        className={cn(
          "min-h-0 flex-1",
          worldActive ? "relative overflow-hidden" : "overflow-auto",
          nav.commentNavigator.visible && COMMENT_NAVIGATOR_SCROLL_PAD_CLASS
        )}
        data-slot="file-canvas-scroll"
        ref={shellRef}
      >
        {softError ? (
          <div className={cn(worldActive && "absolute inset-x-0 top-0 z-30")}>
            <CanvasSoftErrorBanner
              message={softError.message}
              onReload={reload}
              t={props.t}
            />
          </div>
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

        {/* Stable stage/zoom wrappers: `contents` in flow keeps today's layout
            and preserves the imperative mount across mode flips (no re-parent). */}
        <WorldViewportFrame
          active={worldActive}
          aria-label={stageLabels.viewerLabel}
          camera={camera}
          viewportSlot="file-canvas-stage"
          zoomSlot="file-canvas-zoom"
        >
          <div
            className={cn(
              "relative",
              !worldActive &&
                canvasFlowMeasureClass(stageInfo, reading.measureMode),
              !showHost && "hidden"
            )}
            data-canvas-reading={reading.readingActive ? "" : undefined}
            data-pier-canvas-shell=""
            ref={setCanvasShellEl}
            style={reading.shellStyle}
          >
            <div
              className={cn(
                "relative min-h-full w-full",
                // Fill mode: hand the definite height down so a composition's
                // height:100% root fills the viewport (inner scroll owns it).
                stageInfo.fill && !worldActive && "h-full"
              )}
              data-slot="file-canvas-host"
              ref={hostRef}
            />
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
                onPinOpen={nav.onPinOpen}
                onRequestOpenConsumed={nav.onRequestOpenConsumed}
                pickMode={comments.pickMode}
                pins={pins}
                requestOpenKey={nav.navOpenPinKey}
                shell={canvasShellEl}
              />
            ) : null}
          </div>
        </WorldViewportFrame>
      </div>
      {nav.commentNavigator.visible ? (
        <CommentNavigator
          activeIndex={nav.commentNavigator.activeIndex}
          clearLabel={nav.commentNavigator.clearLabel}
          nextLabel={nav.commentNavigator.nextLabel}
          onClear={nav.commentNavigator.onClear}
          onNext={nav.commentNavigator.onNext}
          onPrevious={nav.commentNavigator.onPrevious}
          onRevealCurrent={nav.commentNavigator.onRevealCurrent}
          positionLabel={nav.commentNavigator.positionLabel}
          previousLabel={nav.commentNavigator.previousLabel}
          toolbarLabel={nav.commentNavigator.toolbarLabel}
          total={nav.commentNavigator.total}
        />
      ) : null}
      {worldActive ? (
        <ImagePreviewControls
          effectiveZoom={camera.effectiveZoom}
          labels={stageLabels}
          onZoomChange={camera.setZoom}
          onZoomIn={() => camera.adjustZoom(1)}
          onZoomOut={() => camera.adjustZoom(-1)}
          zoom={camera.zoom}
        />
      ) : null}
    </div>
  );
}
