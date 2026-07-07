import { Alert, AlertDescription, AlertTitle } from "@pier/ui/alert.tsx";
import { Button } from "@pier/ui/button.tsx";
import type { RendererPluginContext } from "@plugins/api/renderer.ts";
import type { IDockviewPanelProps } from "@shared/contracts/dockview.ts";
import type { FileEntry } from "@shared/contracts/file.ts";
import type { PanelContext } from "@shared/contracts/panel.ts";
import { Save } from "lucide-react";
import {
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import { FileEditorAdapter } from "./file-editor-adapter.tsx";
import {
  EmptyFileState,
  FilePanelShell,
  MissingTemporaryState,
  ReadOnlyErrorState,
  StatusLabel,
  ViewModeButton,
} from "./file-panel-parts.tsx";
import {
  FileTreeSidebar,
  filePanelProjectRoot,
  useProjectFileTreeCollapsed,
} from "./file-tree-sidebar.tsx";
import {
  ensureDiskDocument,
  getDocument,
  getDocumentForPanelSource,
  markDocumentError,
  markDocumentLoaded,
  markDocumentLoading,
  markDocumentSaved,
  markDocumentSaveError,
  removeDocument,
  restoreUntitledDocumentFromPanelSource,
  updateDocumentContents,
  useFilesDocument,
} from "./files-document-store.ts";
import {
  type FilesDocument,
  type FilesDocumentPanelSource,
  type FileViewMode,
  isDiskSourceRootAllowed,
  parseFilesDocumentPanelSource,
} from "./files-document-types.ts";
import { createFilesTranslate, type FilesTranslate } from "./files-i18n.ts";

type FilePanelFilesApi = Pick<
  RendererPluginContext["files"],
  "readText" | "writeText"
>;

interface FilesFilePanelParams {
  context?: PanelContext;
  source?: unknown;
}

interface FilePanelRuntimeProps
  extends IDockviewPanelProps<FilesFilePanelParams> {
  runtimeContext?: RendererPluginContext;
  runtimeFiles?: FilePanelFilesApi;
}

type ParsedPanelSourceState =
  | { kind: "empty" }
  | { kind: "invalid"; message: string; title: string }
  | { kind: "source"; source: FilesDocumentPanelSource };

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message.length > 0
    ? error.message
    : fallback;
}

function sourceTitle(
  source: FilesDocumentPanelSource | null,
  t: FilesTranslate
): string {
  if (!source) {
    return t("filePanel.title", "File");
  }
  if (source.kind === "untitled") {
    return source.name;
  }
  return source.path.split("/").filter(Boolean).at(-1) ?? source.path;
}

function parseSourceState(
  params: unknown,
  t: FilesTranslate
): ParsedPanelSourceState {
  if (!params || typeof params !== "object" || !("source" in params)) {
    return { kind: "empty" };
  }

  const source = parseFilesDocumentPanelSource(params);
  if (!source) {
    return {
      kind: "invalid",
      message: t(
        "filePanel.errors.invalidParams",
        "The saved panel parameters are invalid."
      ),
      title: t("filePanel.title", "File"),
    };
  }

  return { kind: "source", source };
}

function useDocumentId(source: FilesDocumentPanelSource | null): string | null {
  return useMemo(() => {
    if (!source) {
      return null;
    }
    if (source.kind === "untitled") {
      return source.id;
    }
    return ensureDiskDocument({ path: source.path, root: source.root }).id;
  }, [source]);
}

function useRestoreUntitledDocument(
  source: FilesDocumentPanelSource | null
): void {
  useEffect(() => {
    if (source?.kind !== "untitled") {
      return;
    }
    restoreUntitledDocumentFromPanelSource(source);
  }, [source]);
}

function useDiskDocumentLoader(
  document: FilesDocument | null,
  files: FilePanelFilesApi | undefined,
  t: FilesTranslate
): void {
  useEffect(() => {
    if (!files || document?.source.kind !== "disk") {
      return;
    }

    const activeDocument = getDocument(document.id);
    if (activeDocument?.loadState !== "idle") {
      return;
    }

    markDocumentLoading(document.id);
    const loadingDocument = getDocument(document.id);
    if (loadingDocument?.loadState !== "loading") {
      return;
    }

    const { path, root } = document.source;
    files
      .readText({ path, root })
      .then((contents) => {
        markDocumentLoaded(document.id, contents);
      })
      .catch((readError: unknown) => {
        markDocumentError(
          document.id,
          errorMessage(
            readError,
            t("filePanel.errors.read.fallback", "Unable to read file contents.")
          )
        );
      });
  }, [document, files, t]);
}

function useRemoveUntitledOnUnmount(
  source: FilesDocumentPanelSource | null,
  document: FilesDocument | null
): void {
  const sourceDocumentId = source?.kind === "untitled" ? source.id : null;
  const isUntitledDocument = document?.source.kind === "untitled";

  useEffect(() => {
    if (!(sourceDocumentId && isUntitledDocument)) {
      return;
    }

    return () => {
      removeDocument(sourceDocumentId);
    };
  }, [isUntitledDocument, sourceDocumentId]);
}

function FilePanelContent({
  runtimeContext,
  runtimeFiles,
  ...props
}: FilePanelRuntimeProps) {
  const files = runtimeContext?.files ?? runtimeFiles;
  const t = useMemo(
    () => createFilesTranslate(runtimeContext),
    [runtimeContext]
  );
  const sourceState = useMemo(
    () => parseSourceState(props.params, t),
    [props.params, t]
  );
  const sourceFromParams =
    sourceState.kind === "source" ? sourceState.source : null;
  const [selectedSource, setSelectedSource] =
    useState<FilesDocumentPanelSource | null>(sourceFromParams);
  const [mode, setMode] = useState<FileViewMode>("source");
  const [saving, setSaving] = useState(false);
  const root = filePanelProjectRoot(props.params?.context);
  const [treeCollapsed, setTreeCollapsed] = useProjectFileTreeCollapsed(root);

  useEffect(() => {
    setSelectedSource(sourceFromParams);
  }, [sourceFromParams]);

  const handleOpenFileFromTree = useCallback(
    (entry: FileEntry) => {
      if (selectedSource) {
        const activeDocument = getDocumentForPanelSource(selectedSource);
        if (activeDocument?.dirty) {
          runtimeContext?.notifications.info(
            t(
              "filePanel.tree.blockedByDirtyDocument",
              "Save or discard the current file before opening another file from the tree."
            )
          );
          return;
        }
      }

      const nextSource: FilesDocumentPanelSource = {
        kind: "disk",
        path: entry.path,
        root: entry.root,
      };
      const name = entry.path.split("/").at(-1) ?? entry.path;
      ensureDiskDocument({ name, path: entry.path, root: entry.root });
      setSelectedSource(nextSource);
      props.api.updateParameters({
        ...(props.params ?? {}),
        source: nextSource,
      });
      props.api.setTitle(name);
    },
    [props.api, props.params, runtimeContext, selectedSource, t]
  );

  const sidebar = runtimeContext ? (
    <FileTreeSidebar
      collapsed={treeCollapsed}
      context={runtimeContext}
      onCollapsedChange={setTreeCollapsed}
      onOpenFile={handleOpenFileFromTree}
      root={root}
    />
  ) : null;

  let content: ReactNode;
  if (
    selectedSource?.kind === "disk" &&
    !isDiskSourceRootAllowed(selectedSource.root, props.params?.context)
  ) {
    content = (
      <ReadOnlyErrorState
        message={t(
          "filePanel.errors.outsideWorkspace",
          "This file source is outside the restored workspace context."
        )}
        t={t}
        title={sourceTitle(selectedSource, t)}
      />
    );
  } else if (sourceState.kind === "invalid") {
    content = (
      <ReadOnlyErrorState
        message={sourceState.message}
        t={t}
        title={sourceState.title}
      />
    );
  } else if (selectedSource) {
    content = (
      <ResolvedFilePanel
        files={files}
        mode={mode}
        onModeChange={setMode}
        onSavingChange={setSaving}
        saving={saving}
        source={selectedSource}
        t={t}
      />
    );
  } else {
    content = <EmptyFileState hasProjectTree={Boolean(root)} t={t} />;
  }

  return <FilePanelShell sidebar={sidebar}>{content}</FilePanelShell>;
}

function ResolvedFilePanel({
  files,
  mode,
  onModeChange,
  onSavingChange,
  saving,
  source,
  t,
}: {
  files: FilePanelFilesApi | undefined;
  mode: FileViewMode;
  onModeChange: (mode: FileViewMode) => void;
  onSavingChange: (saving: boolean) => void;
  saving: boolean;
  source: FilesDocumentPanelSource;
  t: FilesTranslate;
}) {
  const documentId = useDocumentId(source);
  useRestoreUntitledDocument(source);
  const document = useFilesDocument(documentId ?? "");

  useDiskDocumentLoader(document, files, t);
  useRemoveUntitledOnUnmount(source, document);

  const handleChange = useCallback(
    (contents: string) => {
      if (!document || document.readOnly) {
        return;
      }
      updateDocumentContents(document.id, contents);
    },
    [document]
  );

  const handleSave = useCallback(async () => {
    if (!(files && document) || document.source.kind !== "disk") {
      return;
    }

    const savedContents = document.currentContents;
    onSavingChange(true);
    try {
      await files.writeText({
        contents: savedContents,
        path: document.source.path,
        root: document.source.root,
      });
      markDocumentSaved(document.id, savedContents);
    } catch (writeError) {
      markDocumentSaveError(
        document.id,
        errorMessage(
          writeError,
          t("filePanel.errors.save.fallback", "Unable to save file contents.")
        )
      );
    } finally {
      onSavingChange(false);
    }
  }, [document, files, onSavingChange, t]);

  if (!document) {
    if (source.kind === "untitled") {
      return <MissingTemporaryState name={source.name} t={t} />;
    }
    return (
      <ReadOnlyErrorState
        message={t(
          "filePanel.errors.diskDocumentMissing",
          "This disk file document could not be restored."
        )}
        t={t}
        title={sourceTitle(source, t)}
      />
    );
  }

  // File operations are exposed only through document capabilities. This first
  // release intentionally renders save for disk files only; saveAs/delete/move/
  // rename/reveal need dedicated UI, confirmation flows, and tests before use.
  const canSave =
    document.source.kind === "disk" &&
    document.capabilities.includes("save") &&
    document.dirty &&
    !document.readOnly &&
    document.loadState === "loaded" &&
    !saving;

  return (
    <div className="flex h-full min-h-0 flex-col bg-background">
      <header className="flex items-center justify-between gap-3 border-border border-b px-4 py-3">
        <div className="flex min-w-0 items-center gap-2">
          <h1 className="truncate font-semibold text-foreground text-sm">
            {document.name}
          </h1>
          <StatusLabel document={document} t={t} />
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <div className="flex items-center gap-1 rounded-lg border border-border bg-muted/40 p-0.5">
            <ViewModeButton
              active={mode === "source"}
              onClick={() => onModeChange("source")}
            >
              {t("filePanel.view.source", "Source")}
            </ViewModeButton>
            <ViewModeButton
              active={mode === "preview"}
              onClick={() => onModeChange("preview")}
            >
              {t("filePanel.view.preview", "Preview")}
            </ViewModeButton>
          </div>
          {document.source.kind === "disk" ? (
            <Button
              disabled={!canSave}
              onClick={handleSave}
              size="sm"
              type="button"
              variant="outline"
            >
              <Save data-icon="inline-start" />
              {t("filePanel.save", "Save")}
            </Button>
          ) : null}
        </div>
      </header>
      {document.error ? (
        <div className="px-4 py-3">
          <Alert variant="destructive">
            <AlertTitle>
              {document.loadState === "error"
                ? t("filePanel.errors.read.title", "Unable to read file")
                : t("filePanel.errors.save.title", "Unable to save file")}
            </AlertTitle>
            <AlertDescription>{document.error}</AlertDescription>
          </Alert>
        </div>
      ) : null}
      <main className="min-h-0 flex-1 overflow-hidden">
        <FileEditorAdapter
          labels={{
            diffUnsupported: t(
              "filePanel.view.diffUnsupported",
              "Diff view is not enabled yet."
            ),
            richUnsupported: t(
              "filePanel.view.richUnsupported",
              "Rich Markdown editing is not enabled yet."
            ),
            sourceEditor: t("filePanel.editor.sourceLabel", "Source editor"),
          }}
          language={document.language}
          mode={mode}
          onChange={handleChange}
          readOnly={document.readOnly || document.loadState === "loading"}
          value={document.currentContents}
        />
      </main>
    </div>
  );
}

export function createFilePanel(context: RendererPluginContext) {
  return function RegisteredFilePanel(
    props: IDockviewPanelProps<FilesFilePanelParams>
  ) {
    return <FilePanelContent {...props} runtimeContext={context} />;
  };
}

export function FilePanel(props: IDockviewPanelProps<FilesFilePanelParams>) {
  return <FilePanelContent {...props} />;
}
