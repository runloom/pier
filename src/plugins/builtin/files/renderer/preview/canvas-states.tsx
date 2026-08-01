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
import type { LiveModuleDiagnostic } from "@shared/contracts/live-modules.ts";
import { FileQuestion } from "lucide-react";
import type { FilesTranslate } from "../i18n.ts";

/**
 * Presentational shells for the canvas preview: not-a-canvas, compile failure,
 * hot-reload soft error and the delayed loading skeleton. Kept beside the
 * controller so `file-preview/canvas.tsx` stays about compile + mount.
 */

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
            "Open a canvas under .pier/canvases (e.g. *.canvas.tsx)."
          )}
        </EmptyDescription>
      </EmptyHeader>
    </Empty>
  );
}

export function CanvasSoftErrorBanner(props: {
  message: string;
  onReload: () => void;
  t: FilesTranslate;
}) {
  return (
    <div
      className="border-border border-b bg-muted/40 px-6 py-3"
      data-slot="file-canvas-soft-error"
      role="alert"
    >
      <p className="font-medium text-sm">
        {props.t("filePanel.canvas.compileFailed", "Couldn’t compile canvas")}
      </p>
      <p className="mt-1 text-muted-foreground text-xs">
        {props.message.trim().length > 0
          ? props.message
          : props.t(
              "filePanel.canvas.compileFailedHint",
              "Fix the canvas file or its imports, then reload."
            )}
      </p>
      <div className="mt-2">
        <Button
          onClick={props.onReload}
          size="sm"
          type="button"
          variant="outline"
        >
          {props.t("filePanel.canvas.reload", "Reload")}
        </Button>
      </div>
    </div>
  );
}

export function CanvasCompileErrorEmpty(props: {
  diagnostics: LiveModuleDiagnostic[];
  message: string;
  onReload: () => void;
  t: FilesTranslate;
}) {
  return (
    <Empty className="min-h-64 py-12">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <FileQuestion />
        </EmptyMedia>
        <EmptyTitle>
          {props.t("filePanel.canvas.compileFailed", "Couldn’t compile canvas")}
        </EmptyTitle>
        <EmptyDescription>
          {props.message.trim().length > 0
            ? props.message
            : props.t(
                "filePanel.canvas.compileFailedHint",
                "Fix the canvas file or its imports, then reload."
              )}
        </EmptyDescription>
      </EmptyHeader>
      {props.diagnostics.length > 1 ? (
        <div
          className="mx-auto w-full max-w-lg px-6 text-left"
          data-slot="file-canvas-diagnostics"
        >
          <p className="mb-2 font-medium text-muted-foreground text-xs">
            {props.t("filePanel.canvas.diagnosticsHeading", "Details")}
          </p>
          <ul className="flex list-disc flex-col gap-1.5 pl-4 text-muted-foreground text-xs">
            {props.diagnostics.map((diagnostic) => {
              const line = diagnostic.file
                ? `${diagnostic.file}: ${diagnostic.message}`
                : diagnostic.message;
              return <li key={line}>{line}</li>;
            })}
          </ul>
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
