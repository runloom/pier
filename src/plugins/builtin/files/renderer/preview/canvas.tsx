import { cn } from "@pier/ui/utils.ts";
import type { RendererPluginContext } from "@plugins/api/renderer.ts";
import {
  detectProjectCanvasFramework,
  projectCanvasLocation,
} from "@shared/live-module-canvas-path.ts";
import { useEffect, useRef, useState } from "react";
import type { FilesTranslate } from "../i18n.ts";
import {
  markCanvasActive,
  setCanvasBusy,
  unmarkCanvasActive,
  useCanvasChrome,
} from "./canvas-chrome-store.ts";
import {
  CANVAS_SKELETON_DELAY_MS,
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

/**
 * Live Modules preview inside the files panel (same shell as Markdown preview).
 *
 * The compile + mount lifecycle lives in `useCanvasCompileSession`; this
 * component owns the refs, the toolbar chrome store, and the state rendering
 * (pending / loading / ready / error + hot-reload soft-error banner).
 *
 * - First open / path change: blank host; skeleton only if still pending after
 *   {@link CANVAS_SKELETON_DELAY_MS}.
 */
export function FileCanvasPreview(props: {
  context: RendererPluginContext;
  path: string;
  root: string;
  t: FilesTranslate;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const unmountRef = useRef<(() => void) | null>(null);
  /** Identity of the module currently mounted in the host (hot-reload match key). */
  const mountedIdentityRef = useRef<string | null>(null);
  const mountedModuleIdRef = useRef<string | null>(null);
  const [nonce, setNonce] = useState(0);
  const [state, setState] = useState<CanvasPreviewState>({ kind: "pending" });

  const canvasLocation = projectCanvasLocation(props.path);
  const relPath = canvasLocation?.relPath ?? null;
  const framework = detectProjectCanvasFramework(props.path) ?? "react";

  // Tear down only when the preview component itself unmounts — not on every
  // hot-reload effect re-run (that would flash empty before recompile).
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

  // Panel toolbar visibility: while this preview is mounted, the toolbar's
  // Reload button for this module shows. Cleanup runs on relPath change and
  // on component unmount (refcounted, so multi-panel stays correct).
  useEffect(() => {
    if (!relPath) {
      return;
    }
    markCanvasActive(relPath);
    return () => {
      unmarkCanvasActive(relPath);
    };
  }, [relPath]);

  // Toolbar Reload (header trailing slot) bumps the per-module counter; we
  // recompile here. Baseline on first mount so a stale counter from a previous
  // session of this module doesn't trigger an immediate duplicate compile.
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

  // Publish busy state for the toolbar Reload disabled state.
  useEffect(() => {
    if (!relPath) {
      return;
    }
    setCanvasBusy(
      relPath,
      state.kind === "pending" || state.kind === "loading"
    );
  }, [relPath, state]);

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
      className="flex min-h-0 flex-1 flex-col overflow-auto bg-background"
      data-framework={framework}
      data-slot="file-canvas-preview"
    >
      {softError ? (
        <CanvasSoftErrorBanner
          isRuntime={softError.isRuntime}
          message={softError.message}
          onReload={reload}
          t={props.t}
        />
      ) : null}

      {state.kind === "error" ? (
        <CanvasCompileErrorEmpty
          diagnostics={state.diagnostics}
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

      {/* Host stays mounted (incl. error) so Reload / remount always has a node. */}
      <div
        className={cn(
          "mx-auto min-h-full w-full max-w-5xl px-6 py-5",
          !showHost && "hidden"
        )}
        data-pier-canvas-shell=""
        ref={hostRef}
      />
    </div>
  );
}
