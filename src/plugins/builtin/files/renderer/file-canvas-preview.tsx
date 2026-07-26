import { Button } from "@pier/ui/button.tsx";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@pier/ui/empty.tsx";
import { Skeleton } from "@pier/ui/skeleton.tsx";
import { cn } from "@pier/ui/utils.ts";
import { mountLiveModuleExport } from "@plugins/api/live-module-mount.ts";
import type { RendererPluginContext } from "@plugins/api/renderer.ts";
import {
  LIVE_MODULE_DEFAULT_PROJECT_DIRECTORY,
  type LiveModuleDiagnostic,
  projectLiveRootId,
  projectLiveRootSpec,
} from "@shared/contracts/live-modules.ts";
import {
  type PierCanvasMeta,
  parsePierCanvasMeta,
} from "@shared/contracts/pier-canvas.ts";
import {
  detectProjectCanvasFramework,
  projectCanvasLocation,
} from "@shared/live-module-canvas-path.ts";
import type { LiveModuleFramework } from "@shared/live-module-framework.ts";
import { FileQuestion } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { FilesTranslate } from "./files-i18n.ts";

/** Only show skeleton if compile still pending after this delay (avoids flash). */
export const CANVAS_SKELETON_DELAY_MS = 200;

interface SoftError {
  diagnostics: LiveModuleDiagnostic[];
  message: string;
}

type PreviewState =
  | { kind: "pending" }
  | { kind: "loading" }
  | {
      kind: "ready";
      meta: PierCanvasMeta | null;
      framework: LiveModuleFramework;
      /** Hot-reload compile failure: keep previous mount, show banner. */
      softError?: SoftError;
    }
  | {
      kind: "error";
      message: string;
      diagnostics: LiveModuleDiagnostic[];
    };

function moduleIdentity(
  root: string,
  contentDirectory: string,
  relPath: string,
  framework: LiveModuleFramework
): string {
  // Include content directory so .pier/canvases vs .pier/plans never share a
  // hot-reload identity when relative paths collide.
  return `${root}\0${contentDirectory}\0${relPath}\0${framework}`;
}

/**
 * Live Modules preview inside the files panel (same shell as Markdown preview).
 * React uses host pier/canvas; Vue/Solid/Svelte use project-bundled runtimes.
 *
 * Loading UX:
 * - Same-module hot reload: keep previous canvas until the new bundle mounts (no skeleton).
 * - Hot-reload failure: keep previous mount and show a soft-error banner.
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
  const [nonce, setNonce] = useState(0);
  const [state, setState] = useState<PreviewState>({ kind: "pending" });

  const canvasLocation = projectCanvasLocation(props.path);
  const relPath = canvasLocation?.relPath ?? null;
  const contentDirectory =
    canvasLocation?.directory ?? LIVE_MODULE_DEFAULT_PROJECT_DIRECTORY;
  const framework = detectProjectCanvasFramework(props.path) ?? "react";
  const liveModules = props.context.liveModules;

  // Tear down only when the preview component itself unmounts — not on every
  // hot-reload effect re-run (that would flash empty before recompile).
  useEffect(
    () => () => {
      unmountRef.current?.();
      unmountRef.current = null;
      mountedIdentityRef.current = null;
    },
    []
  );

  useEffect(() => {
    // `nonce` re-triggers compile on file stale events and manual Reload.
    const reloadGeneration = nonce;

    if (!(relPath && liveModules)) {
      unmountRef.current?.();
      unmountRef.current = null;
      mountedIdentityRef.current = null;
      setState({
        diagnostics: [],
        kind: "error",
        message: props.t(
          "filePanel.canvas.notUnderCanvases",
          "Open a canvas under .pier/canvases or .pier/plans (e.g. *.canvas.tsx)."
        ),
      });
      return;
    }

    const hostEl = hostRef.current;
    if (!hostEl) {
      return;
    }

    const identity = moduleIdentity(
      props.root,
      contentDirectory,
      relPath,
      framework
    );
    // Mark host with compile generation (stale / Reload bump `nonce`).
    hostEl.dataset.pierCanvasCompile = String(reloadGeneration);
    let cancelled = false;
    const stillOwner = (): boolean =>
      !cancelled &&
      hostEl.dataset.pierCanvasCompile === String(reloadGeneration);

    // Same module already on screen → keep UI until the new bundle mounts.
    const isHotReload =
      mountedIdentityRef.current === identity && unmountRef.current !== null;

    let skeletonTimer: ReturnType<typeof setTimeout> | null = null;

    const clearSkeletonTimer = () => {
      if (skeletonTimer !== null) {
        clearTimeout(skeletonTimer);
        skeletonTimer = null;
      }
    };

    if (isHotReload) {
      // Keep ready UI + previous mount while recompiling.
    } else {
      // First open or different canvas: drop previous content immediately
      // (do not show the wrong file), but delay the skeleton to avoid flash.
      unmountRef.current?.();
      unmountRef.current = null;
      mountedIdentityRef.current = null;
      hostEl.replaceChildren();
      setState({ kind: "pending" });
      skeletonTimer = setTimeout(() => {
        if (!stillOwner()) {
          return;
        }
        setState((current) =>
          current.kind === "pending" ? { kind: "loading" } : current
        );
      }, CANVAS_SKELETON_DELAY_MS);
    }

    const baseRootId = projectLiveRootId(props.root);
    const rootIdSuffix =
      contentDirectory === LIVE_MODULE_DEFAULT_PROJECT_DIRECTORY
        ? ""
        : `.${contentDirectory.replace(/^\./u, "").replaceAll("/", "-")}`;
    // Must match registerRoot id — used for stale events + unregister.
    const rootId = `${baseRootId}${rootIdSuffix}`;
    const run = async () => {
      try {
        const spec = projectLiveRootSpec({
          directory: contentDirectory,
          // Distinct root id per content directory so plans/ and canvases/
          // registrations do not clobber each other (id charset: a-z0-9._-).
          id: rootId,
          projectRootPath: props.root,
        });
        await liveModules.registerRoot(spec);
        if (!stillOwner()) {
          return;
        }
        if (!relPath) {
          throw new Error("Not a project canvas path");
        }
        const result = await liveModules.compile(spec.id, relPath);
        if (!stillOwner()) {
          return;
        }
        if (!result.ok) {
          clearSkeletonTimer();
          const soft: SoftError = {
            diagnostics: result.diagnostics,
            message:
              result.diagnostics[0]?.message ??
              props.t(
                "filePanel.canvas.compileFailed",
                "Couldn’t compile canvas"
              ),
          };
          if (isHotReload && unmountRef.current) {
            // Keep previous canvas; surface diagnostics as a banner.
            setState((current) =>
              current.kind === "ready"
                ? { ...current, softError: soft }
                : {
                    diagnostics: soft.diagnostics,
                    kind: "error",
                    message: soft.message,
                  }
            );
            return;
          }
          unmountRef.current?.();
          unmountRef.current = null;
          mountedIdentityRef.current = null;
          hostEl.replaceChildren();
          setState({
            diagnostics: soft.diagnostics,
            kind: "error",
            message: soft.message,
          });
          return;
        }
        const mod = (await import(/* @vite-ignore */ result.url)) as Record<
          string,
          unknown
        >;
        if (!stillOwner()) {
          return;
        }

        // Atomic swap: tear down previous only once the new module is ready.
        // stillOwner() re-check prevents a superseded generation from stealing the host.
        unmountRef.current?.();
        unmountRef.current = null;
        hostEl.replaceChildren();
        const nextUnmount = await mountLiveModuleExport(hostEl, framework, mod);
        if (!stillOwner()) {
          nextUnmount();
          return;
        }
        clearSkeletonTimer();
        unmountRef.current = nextUnmount;
        mountedIdentityRef.current = identity;
        setState({
          framework,
          kind: "ready",
          meta:
            framework === "react"
              ? parsePierCanvasMeta(mod.canvas)
              : (parsePierCanvasMeta(mod.canvas) ?? {
                  kind: "composition",
                  title: relPath,
                }),
        });
      } catch (error) {
        if (!stillOwner()) {
          return;
        }
        clearSkeletonTimer();
        const message =
          error instanceof Error
            ? error.message
            : props.t(
                "filePanel.canvas.compileFailed",
                "Couldn’t compile canvas"
              );
        if (isHotReload && unmountRef.current) {
          setState((current) =>
            current.kind === "ready"
              ? {
                  ...current,
                  softError: { diagnostics: [], message },
                }
              : { diagnostics: [], kind: "error", message }
          );
          return;
        }
        unmountRef.current?.();
        unmountRef.current = null;
        mountedIdentityRef.current = null;
        hostEl.replaceChildren();
        setState({
          diagnostics: [],
          kind: "error",
          message,
        });
      }
    };

    run().catch(() => undefined);

    const stopWatch = liveModules.onChanged((event) => {
      if (event.type !== "stale") {
        return;
      }
      if (event.rootId !== rootId || event.moduleId !== relPath) {
        return;
      }
      setNonce((value) => value + 1);
    });

    return () => {
      cancelled = true;
      clearSkeletonTimer();
      stopWatch();
      // Refcounted release — last panel for this project drops watchers/tickets.
      liveModules.unregisterRoot(rootId).catch(() => undefined);
    };
  }, [
    contentDirectory,
    framework,
    liveModules,
    nonce,
    props.root,
    props.t,
    relPath,
  ]);

  if (!relPath) {
    return (
      <Empty className="min-h-64 py-12">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <FileQuestion />
          </EmptyMedia>
          <EmptyTitle>
            {props.t(
              "filePanel.canvas.unavailableTitle",
              "Can’t preview canvas"
            )}
          </EmptyTitle>
          <EmptyDescription>
            {props.t(
              "filePanel.canvas.notUnderCanvases",
              "Open a canvas under .pier/canvases or .pier/plans (e.g. *.canvas.tsx)."
            )}
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  }

  const compilingLabel = props.t(
    "filePanel.canvas.compiling",
    "Compiling canvas…"
  );
  const showSkeleton = state.kind === "loading";
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
        <div
          className="border-border border-b bg-muted/40 px-6 py-3"
          data-slot="file-canvas-soft-error"
          role="alert"
        >
          <p className="font-medium text-sm">
            {props.t(
              "filePanel.canvas.compileFailed",
              "Couldn’t compile canvas"
            )}
          </p>
          <p className="mt-1 text-muted-foreground text-xs">
            {softError.message.trim().length > 0
              ? softError.message
              : props.t(
                  "filePanel.canvas.compileFailedHint",
                  "Fix the canvas file or its imports, then reload."
                )}
          </p>
          <div className="mt-2">
            <Button
              onClick={() => {
                setNonce((value) => value + 1);
              }}
              size="sm"
              type="button"
              variant="outline"
            >
              {props.t("filePanel.canvas.reload", "Reload")}
            </Button>
          </div>
        </div>
      ) : null}

      {state.kind === "error" ? (
        <Empty className="min-h-64 py-12">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <FileQuestion />
            </EmptyMedia>
            <EmptyTitle>
              {props.t(
                "filePanel.canvas.compileFailed",
                "Couldn’t compile canvas"
              )}
            </EmptyTitle>
            <EmptyDescription>
              {state.message.trim().length > 0
                ? state.message
                : props.t(
                    "filePanel.canvas.compileFailedHint",
                    "Fix the canvas file or its imports, then reload."
                  )}
            </EmptyDescription>
          </EmptyHeader>
          {state.diagnostics.length > 1 ? (
            <div
              className="mx-auto w-full max-w-lg px-6 text-left"
              data-slot="file-canvas-diagnostics"
            >
              <p className="mb-2 font-medium text-muted-foreground text-xs">
                {props.t("filePanel.canvas.diagnosticsHeading", "Details")}
              </p>
              <ul className="flex list-disc flex-col gap-1.5 pl-4 text-muted-foreground text-xs">
                {state.diagnostics.map((diagnostic) => {
                  const line = diagnostic.file
                    ? `${diagnostic.file}: ${diagnostic.message}`
                    : diagnostic.message;
                  return <li key={line}>{line}</li>;
                })}
              </ul>
            </div>
          ) : null}
          <EmptyContent>
            <Button
              onClick={() => {
                setNonce((value) => value + 1);
              }}
              type="button"
              variant="outline"
            >
              {props.t("filePanel.canvas.reload", "Reload")}
            </Button>
          </EmptyContent>
        </Empty>
      ) : null}

      {showSkeleton ? (
        <div
          className="mx-auto w-full max-w-5xl px-6 py-5"
          data-slot="file-canvas-loading"
          role="status"
        >
          <span className="sr-only">{compilingLabel}</span>
          {/* Geometry aligned with markdown-preview loading skeleton. */}
          <div className="flex flex-col gap-3">
            <Skeleton className="h-8 w-1/3 rounded-md" />
            <Skeleton className="h-4 w-full rounded-md" />
            <Skeleton className="h-4 w-4/5 rounded-md" />
            <Skeleton className="h-28 w-full rounded-md" />
          </div>
        </div>
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
