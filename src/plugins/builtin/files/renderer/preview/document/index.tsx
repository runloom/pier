import type { RendererPluginContext } from "@plugins/api/renderer.ts";
import { lazy, type ReactNode, Suspense, useCallback } from "react";
import type {
  FilesDocument,
  FilesDocumentDocumentPreview,
} from "../../document/types.ts";
import type { FilesTranslate } from "../../i18n.ts";
import { DocumentPreviewErrorBoundary } from "./error-boundary.tsx";
import { openDocumentInDefaultApp } from "./open-default.ts";
import { DocumentPreviewFrame } from "./shell.tsx";
import {
  DocumentErrorState,
  DocumentLoadingState,
  DocumentUnsupportedState,
} from "./states.tsx";
import type { DocumentPreviewContext } from "./types.ts";
import { usePreviewSource } from "./use-preview-source.ts";

const FilePdfPreview = lazy(() => import("../pdf/index.tsx"));
const FileDocxPreview = lazy(() => import("../docx/index.tsx"));
const FileXlsxPreview = lazy(() => import("../xlsx/index.tsx"));

function DocumentPreviewLoading(props: { t: FilesTranslate }) {
  return (
    <DocumentPreviewFrame t={props.t}>
      <DocumentLoadingState t={props.t} />
    </DocumentPreviewFrame>
  );
}

function DocumentFormatPreview(props: {
  bytes: Uint8Array;
  context: DocumentPreviewContext;
  fileName: string;
  format: Extract<FilesDocumentDocumentPreview, { kind: "document" }>["format"];
  onOpenInDefaultApp: (() => void) | undefined;
  onRetry: () => void;
  t: FilesTranslate;
}): ReactNode {
  const shared = {
    bytes: props.bytes,
    fileName: props.fileName,
    ...(props.onOpenInDefaultApp
      ? { onOpenInDefaultApp: props.onOpenInDefaultApp }
      : {}),
    onRetry: props.onRetry,
    t: props.t,
  };

  switch (props.format) {
    case "pdf":
      return <FilePdfPreview {...shared} context={props.context} />;
    case "docx":
      return <FileDocxPreview {...shared} context={props.context} />;
    case "xlsx":
      return <FileXlsxPreview {...shared} />;
    default:
      return (
        <DocumentPreviewFrame t={props.t}>
          <DocumentErrorState
            error="renderer-missing"
            {...(props.onOpenInDefaultApp
              ? { onOpenInDefaultApp: props.onOpenInDefaultApp }
              : {})}
            onRetry={props.onRetry}
            t={props.t}
          />
        </DocumentPreviewFrame>
      );
  }
}

function DocumentSourcePreview(props: {
  context: DocumentPreviewContext;
  document: FilesDocument;
  onOpenInDefaultApp: (() => void) | undefined;
  onReload: () => void;
  preview: Extract<FilesDocumentDocumentPreview, { kind: "document" }>;
  t: FilesTranslate;
}) {
  const { context, document, onOpenInDefaultApp, onReload, preview, t } = props;
  const source = document.source;
  const sourceState = usePreviewSource({
    context,
    mime: preview.mime,
    path: source.kind === "disk" ? source.path : "",
    revision: preview.revision,
    root: source.kind === "disk" ? source.root : "",
  });

  const retry = useCallback(() => {
    if (sourceState.status === "error" && sourceState.error === "stale") {
      onReload();
      return;
    }
    sourceState.retry();
  }, [onReload, sourceState]);

  if (sourceState.status === "loading") {
    return <DocumentPreviewLoading t={t} />;
  }
  if (sourceState.status === "error") {
    return (
      <DocumentPreviewFrame t={t}>
        <DocumentErrorState
          error={sourceState.error}
          {...(onOpenInDefaultApp ? { onOpenInDefaultApp } : {})}
          onRetry={retry}
          t={t}
        />
      </DocumentPreviewFrame>
    );
  }

  return (
    <DocumentPreviewErrorBoundary
      fallback={(_error, reset) => (
        <DocumentPreviewFrame t={t}>
          <DocumentErrorState
            error="render-failed"
            {...(onOpenInDefaultApp ? { onOpenInDefaultApp } : {})}
            onRetry={() => {
              reset();
              retry();
            }}
            t={t}
          />
        </DocumentPreviewFrame>
      )}
    >
      <Suspense fallback={<DocumentPreviewLoading t={t} />}>
        <DocumentFormatPreview
          bytes={sourceState.bytes}
          context={context}
          fileName={document.name}
          format={preview.format}
          onOpenInDefaultApp={onOpenInDefaultApp}
          onRetry={retry}
          t={t}
        />
      </Suspense>
    </DocumentPreviewErrorBoundary>
  );
}

export function FileDocumentPreview(props: {
  context: RendererPluginContext;
  document: FilesDocument;
  onReload: () => void;
  preview: FilesDocumentDocumentPreview;
  t: FilesTranslate;
}): ReactNode {
  const { context, document, preview, t } = props;
  const canOpenInDefaultApp =
    document.source.kind === "disk" && !document.deletedOnDisk;
  const onOpenInDefaultApp = canOpenInDefaultApp
    ? () => {
        openDocumentInDefaultApp({ context, document, t }).catch(
          () => undefined
        );
      }
    : undefined;

  if (preview.kind === "document-unsupported") {
    return (
      <DocumentUnsupportedState
        document={document}
        {...(onOpenInDefaultApp ? { onOpenInDefaultApp } : {})}
        preview={preview}
        t={t}
      />
    );
  }

  return (
    <DocumentSourcePreview
      context={context}
      document={document}
      onOpenInDefaultApp={onOpenInDefaultApp}
      onReload={props.onReload}
      preview={preview}
      t={t}
    />
  );
}
