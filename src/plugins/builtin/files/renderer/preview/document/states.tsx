import { Button } from "@pier/ui/button.tsx";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@pier/ui/empty.tsx";
import { ErrorEmpty } from "@pier/ui/error-empty.tsx";
import { Skeleton } from "@pier/ui/skeleton.tsx";
import { FileWarning } from "lucide-react";
import type { ReactNode } from "react";
import type {
  FilesDocument,
  FilesDocumentDocumentPreview,
} from "../../document/types.ts";
import type { FilesTranslate } from "../../i18n.ts";
import type { DocumentRenderError } from "./types.ts";

export function DocumentLoadingState(props: { t: FilesTranslate }) {
  return (
    <div
      aria-busy="true"
      className="flex min-h-64 flex-col gap-3 p-6"
      data-slot="document-preview-loading"
      role="status"
    >
      <span className="sr-only">
        {props.t("filePanel.documentPreview.loading", "Loading document")}
      </span>
      <Skeleton className="h-6 w-1/3 rounded-md" />
      <Skeleton className="h-40 w-full rounded-md" />
      <Skeleton className="h-4 w-4/5 rounded-md" />
    </div>
  );
}

function errorCopy(
  error: DocumentRenderError,
  t: FilesTranslate
): { description: string; title: string } {
  switch (error) {
    case "fetch-failed":
      return {
        description: t(
          "filePanel.documentPreview.fetchFailed.description",
          "The document could not be loaded. Retry, or open it in the default app."
        ),
        title: t(
          "filePanel.documentPreview.fetchFailed.title",
          "Unable to load document"
        ),
      };
    case "stale":
      return {
        description: t(
          "filePanel.documentPreview.stale.description",
          "The file changed on disk. Reload it to see the current version."
        ),
        title: t(
          "filePanel.documentPreview.stale.title",
          "Document changed on disk"
        ),
      };
    case "too-large":
      return {
        description: t(
          "filePanel.documentPreview.tooLarge.description",
          "The file is larger than 64 MB. Open it in the default app to view the full document."
        ),
        title: t(
          "filePanel.documentPreview.tooLarge.title",
          "Document is too large to preview"
        ),
      };
    case "encrypted":
      return {
        description: t(
          "filePanel.documentPreview.renderFailed.description",
          "This file can’t be previewed here. Open it in the default app, or retry."
        ),
        title: t(
          "filePanel.documentPreview.pdf.password",
          "This PDF is password-protected"
        ),
      };
    case "zip-limit":
      return {
        description: t(
          "filePanel.documentPreview.zipLimit.description",
          "The document expands beyond the safe preview limit. Open it in the default app."
        ),
        title: t(
          "filePanel.documentPreview.zipLimit.title",
          "Document is too complex to preview"
        ),
      };
    case "renderer-missing":
      return {
        description: t(
          "filePanel.documentPreview.renderFailed.description",
          "This file can’t be previewed here. Open it in the default app, or retry."
        ),
        title: t(
          "filePanel.documentPreview.rendererMissing",
          "Preview module unavailable"
        ),
      };
    default:
      return {
        description: t(
          "filePanel.documentPreview.renderFailed.description",
          "This file can’t be previewed here. Open it in the default app, or retry."
        ),
        title: t(
          "filePanel.documentPreview.renderFailed.title",
          "Unable to display document"
        ),
      };
  }
}

export function DocumentErrorState(props: {
  error: DocumentRenderError;
  onOpenInDefaultApp?: (() => void) | undefined;
  onRetry: () => void;
  t: FilesTranslate;
}): ReactNode {
  const copy = errorCopy(props.error, props.t);
  return (
    <ErrorEmpty
      className="min-h-64"
      data-slot="document-preview-error"
      {...(props.onOpenInDefaultApp
        ? {
            detailAction: {
              label: props.t(
                "filePanel.documentPreview.openInDefaultApp",
                "Open in default app"
              ),
              onClick: props.onOpenInDefaultApp,
            },
          }
        : {})}
      description={copy.description}
      retryAction={{
        label: props.t("filePanel.documentPreview.retry", "Retry"),
        onClick: props.onRetry,
      }}
      title={copy.title}
    />
  );
}

function unsupportedCopy(
  preview: Extract<
    FilesDocumentDocumentPreview,
    { kind: "document-unsupported" }
  >,
  t: FilesTranslate
): string {
  switch (preview.reason) {
    case "encrypted":
      return t(
        "filePanel.documentPreview.unsupported.encrypted",
        "This document is encrypted, so it can’t be previewed in the workspace."
      );
    case "legacy":
      return t(
        "filePanel.documentPreview.unsupported.legacy",
        "This is an older Office format. Open it in the default app to view it."
      );
    case "too-large":
      return t(
        "filePanel.documentPreview.unsupported.tooLarge",
        "The file is larger than 64 MB, so it can’t be previewed in the workspace."
      );
    default:
      return t(
        "filePanel.documentPreview.unsupported.notSupported",
        "This format can’t be previewed in the workspace."
      );
  }
}

export function DocumentUnsupportedState(props: {
  document: FilesDocument;
  onOpenInDefaultApp?: (() => void) | undefined;
  preview: Extract<
    FilesDocumentDocumentPreview,
    { kind: "document-unsupported" }
  >;
  t: FilesTranslate;
}): ReactNode {
  return (
    <Empty
      className="min-h-64"
      data-slot="document-preview-unsupported"
      role="status"
    >
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <FileWarning />
        </EmptyMedia>
        <EmptyTitle>{props.document.name}</EmptyTitle>
        <EmptyDescription>
          {unsupportedCopy(props.preview, props.t)}
        </EmptyDescription>
        <EmptyDescription>
          {props.t(
            "filePanel.documentPreview.unsupported.hint",
            "Open it in the default app to view the full document."
          )}
        </EmptyDescription>
      </EmptyHeader>
      {props.onOpenInDefaultApp ? (
        <EmptyContent>
          <Button
            onClick={props.onOpenInDefaultApp}
            size="sm"
            type="button"
            variant="outline"
          >
            {props.t(
              "filePanel.documentPreview.openInDefaultApp",
              "Open in default app"
            )}
          </Button>
        </EmptyContent>
      ) : null}
    </Empty>
  );
}
