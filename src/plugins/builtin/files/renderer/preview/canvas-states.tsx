import { Alert, AlertDescription, AlertTitle } from "@pier/ui/alert.tsx";
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
import { LiveModuleMountError } from "@plugins/api/live-module-mount.ts";
import type { LiveModuleDiagnostic } from "@shared/contracts/live-modules.ts";
import { FileQuestion } from "lucide-react";
import type { FilesTranslate } from "../i18n.ts";
import { removeLiveModuleCss } from "./css-cleanup.ts";

/**
 * Presentational shells for the canvas preview: not-a-canvas, compile failure,
 * hot-reload soft error, ready chrome and the delayed loading skeleton.
 */

/** esbuild / Chromium helper death — not a bad `.canvas.tsx` file. */
const PREVIEW_STOPPED_RE =
  /The canvas compiler stopped|The service is no longer running|The service was stopped/u;

export function isCanvasPreviewStoppedFailure(input: {
  diagnostics?: readonly LiveModuleDiagnostic[];
  message: string;
}): boolean {
  if (PREVIEW_STOPPED_RE.test(input.message)) {
    return true;
  }
  return (input.diagnostics ?? []).some((diagnostic) =>
    PREVIEW_STOPPED_RE.test(diagnostic.message)
  );
}

export function formatDiagnosticLocation(
  diagnostic: LiveModuleDiagnostic
): string {
  const parts: string[] = [];
  if (diagnostic.file) {
    parts.push(diagnostic.file);
  }
  if (diagnostic.line != null) {
    parts.push(String(diagnostic.line));
  }
  if (diagnostic.column != null) {
    parts.push(String(diagnostic.column));
  }
  const location = parts.join(":");
  return location.length > 0
    ? `[${location}] ${diagnostic.message}`
    : diagnostic.message;
}

/** Map mount/runtime failures to files-panel i18n copy. */
export function canvasMountErrorMessage(
  error: unknown,
  t: FilesTranslate
): string {
  if (error instanceof LiveModuleMountError) {
    switch (error.code) {
      case "react-no-default":
        return t(
          "filePanel.canvas.mountReactInvalid",
          "React canvas must default-export a component (or export mount)."
        );
      case "svelte-no-default":
        return t(
          "filePanel.canvas.mountSvelteInvalid",
          "Svelte canvas must default-export a component or export mount."
        );
      case "need-mount":
        return t(
          "filePanel.canvas.mountNeedExport",
          "Canvas must export function mount(el) so the host can attach it."
        );
      default: {
        const _exhaustive: never = error.code;
        return _exhaustive;
      }
    }
  }
  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message;
  }
  return t("filePanel.canvas.runtimeFailed", "Canvas crashed while rendering");
}

/**
 * Unmount the mounted canvas and clear host children WITHOUT touching injected
 * CSS — used on the hot-reload swap path, where the replacement bundle's CSS
 * was already injected by `import(url)` and prefix-based removal would delete it.
 */
export function unmountMountedCanvas(
  _hostEl: HTMLElement | null,
  unmountRef: { current: (() => void) | null },
  mountedIdentityRef: { current: string | null }
): void {
  unmountRef.current?.();
  unmountRef.current = null;
  mountedIdentityRef.current = null;
  // Do not `replaceChildren` here. React canvas unmount is deferred so it
  // does not race `createRoot().render()`. The next `mountLiveModule` tears
  // down any leftover root on the same host before creating a new one.
}

/** Unmount previous canvas, clear host children, and drop injected CSS. */
export function clearMountedCanvas(
  hostEl: HTMLElement | null,
  unmountRef: { current: (() => void) | null },
  mountedIdentityRef: { current: string | null },
  moduleId: string | null
): void {
  unmountMountedCanvas(hostEl, unmountRef, mountedIdentityRef);
  if (moduleId) {
    removeLiveModuleCss(moduleId);
  }
}

export function CanvasUnavailableEmpty(props: { t: FilesTranslate }) {
  return (
    <Empty className="min-h-64 py-12">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <FileQuestion />
        </EmptyMedia>
        <EmptyTitle>
          {props.t("filePanel.canvas.unavailableTitle", "Can’t preview canvas")}
        </EmptyTitle>
        <EmptyDescription>
          {props.t(
            "filePanel.canvas.notUnderCanvases",
            "This file isn’t in a canvas preview folder. Adjust folders in Settings → Projects → General."
          )}
        </EmptyDescription>
      </EmptyHeader>
    </Empty>
  );
}

/**
 * Non-blocking banner while a previous successful mount is still visible
 * (hot-reload compile failure / warnings). Not for runtime crashes — those
 * clear the host and use {@link CanvasCompileErrorEmpty}.
 */
export function CanvasSoftErrorBanner(props: {
  message: string;
  onReload: () => void;
  t: FilesTranslate;
}) {
  const previewStopped = isCanvasPreviewStoppedFailure({
    message: props.message,
  });
  let body: string;
  if (previewStopped) {
    body = props.t(
      "filePanel.canvas.previewStoppedHint",
      "Preview stopped unexpectedly. Reload to try again."
    );
  } else if (props.message.trim().length > 0) {
    body = props.message;
  } else {
    body = props.t(
      "filePanel.canvas.compileFailedHint",
      "Fix the canvas file or its imports, then reload."
    );
  }
  const title = previewStopped
    ? props.t("filePanel.canvas.previewStopped", "Couldn’t preview canvas")
    : props.t("filePanel.canvas.compileFailed", "Couldn’t compile canvas");
  return (
    <div
      className="shrink-0 border-border border-b px-4 py-3"
      data-slot="file-canvas-soft-error"
    >
      <Alert variant="warning">
        <AlertTitle>{title}</AlertTitle>
        <AlertDescription>
          <p>{body}</p>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <Button
              onClick={props.onReload}
              size="sm"
              type="button"
              variant="outline"
            >
              {props.t("filePanel.canvas.reload", "Reload")}
            </Button>
          </div>
        </AlertDescription>
      </Alert>
    </div>
  );
}

function canvasErrorEmptyCopy(input: {
  isRuntime: boolean | undefined;
  previewStopped: boolean;
}): {
  hintFallback: string;
  hintKey: string;
  titleFallback: string;
  titleKey: string;
} {
  if (input.previewStopped) {
    return {
      hintFallback: "Preview stopped unexpectedly. Reload to try again.",
      hintKey: "filePanel.canvas.previewStoppedHint",
      titleFallback: "Couldn’t preview canvas",
      titleKey: "filePanel.canvas.previewStopped",
    };
  }
  if (input.isRuntime) {
    return {
      hintFallback: "Fix the runtime error in the canvas, then reload.",
      hintKey: "filePanel.canvas.runtimeFailedHint",
      titleFallback: "Canvas crashed while rendering",
      titleKey: "filePanel.canvas.runtimeFailed",
    };
  }
  return {
    hintFallback: "Fix the canvas file or its imports, then reload.",
    hintKey: "filePanel.canvas.compileFailedHint",
    titleFallback: "Couldn’t compile canvas",
    titleKey: "filePanel.canvas.compileFailed",
  };
}

/**
 * Full-region error when there is no canvas body to show (first compile fail,
 * or runtime crash after ErrorBoundary nulls the tree).
 */
export function CanvasCompileErrorEmpty(props: {
  diagnostics: LiveModuleDiagnostic[];
  /** Runtime crash uses runtimeFailed copy; compile uses compileFailed. */
  isRuntime?: boolean | undefined;
  message: string;
  onReload: () => void;
  t: FilesTranslate;
}) {
  const previewStopped =
    !props.isRuntime &&
    isCanvasPreviewStoppedFailure({
      diagnostics: props.diagnostics,
      message: props.message,
    });
  const copy = canvasErrorEmptyCopy({
    isRuntime: props.isRuntime,
    previewStopped,
  });
  const showDiagnostics = !previewStopped && props.diagnostics.length > 0;
  const showMessage =
    !previewStopped &&
    props.diagnostics.length === 0 &&
    props.message.trim().length > 0;
  return (
    <Empty className="min-h-64 py-12" data-slot="file-canvas-error-empty">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <FileQuestion />
        </EmptyMedia>
        <EmptyTitle>{props.t(copy.titleKey, copy.titleFallback)}</EmptyTitle>
        <EmptyDescription>
          {props.t(copy.hintKey, copy.hintFallback)}
        </EmptyDescription>
      </EmptyHeader>
      {showDiagnostics ? (
        <div
          className="mx-auto w-full max-w-lg px-6 text-left"
          data-slot="file-canvas-diagnostics"
        >
          <p className="mb-2 font-medium text-muted-foreground text-xs">
            {props.t("filePanel.canvas.diagnosticsHeading", "Details")}
          </p>
          <ul className="flex list-disc flex-col gap-1.5 pl-4 text-muted-foreground text-xs">
            {props.diagnostics.map((diagnostic) => {
              const line = formatDiagnosticLocation(diagnostic);
              return <li key={line}>{line}</li>;
            })}
          </ul>
        </div>
      ) : null}
      {showMessage ? (
        <div className="mx-auto w-full max-w-lg px-6 text-left">
          <p className="text-muted-foreground text-xs">{props.message}</p>
        </div>
      ) : null}
      <EmptyContent>
        <Button onClick={props.onReload} type="button" variant="outline">
          {props.t("filePanel.canvas.reload", "Reload")}
        </Button>
      </EmptyContent>
    </Empty>
  );
}

export function CanvasLoadingSkeleton(props: { label: string }) {
  return (
    <div
      className="mx-auto w-full max-w-5xl px-6 py-5"
      data-slot="file-canvas-loading"
      role="status"
    >
      <span className="sr-only">{props.label}</span>
      {/* Geometry aligned with markdown-preview loading skeleton. */}
      <div className="flex flex-col gap-3">
        <Skeleton className="h-8 w-1/3 rounded-md" />
        <Skeleton className="h-4 w-full rounded-md" />
        <Skeleton className="h-4 w-4/5 rounded-md" />
        <Skeleton className="h-28 w-full rounded-md" />
      </div>
    </div>
  );
}
