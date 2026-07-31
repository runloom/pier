import {
  type LSPClient,
  LSPPlugin,
  Workspace,
  type WorkspaceFile,
} from "@codemirror/lsp-client";
import { ChangeSet, type Text } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import { absolutePathFromFileUri } from "@shared/lsp-uri.ts";

interface WorkspaceFileUpdate {
  changes: ChangeSet;
  file: WorkspaceFile;
  prevDoc: Text;
}

interface PierWorkspaceFile extends WorkspaceFile {
  readonly syncedDocs: WeakMap<EditorView, Text>;
  readonly views: Set<EditorView>;
}

/** Files workspace with shared LSP documents across editor views. */
export class PierFilesWorkspace extends Workspace {
  files: PierWorkspaceFile[] = [];
  readonly #fileVersions: Record<string, number> = Object.create(
    null
  ) as Record<string, number>;
  readonly #onDisplayFile: (absolutePath: string) => Promise<EditorView | null>;

  constructor(
    client: LSPClient,
    onDisplayFile: (absolutePath: string) => Promise<EditorView | null>
  ) {
    super(client);
    this.#onDisplayFile = onDisplayFile;
  }

  #nextFileVersion(uri: string): number {
    const next = (this.#fileVersions[uri] ?? -1) + 1;
    this.#fileVersions[uri] = next;
    return next;
  }

  syncFiles(): readonly WorkspaceFileUpdate[] {
    const result: WorkspaceFileUpdate[] = [];
    for (const file of this.files) {
      for (const view of file.views) {
        const plugin = LSPPlugin.get(view);
        if (!plugin) {
          continue;
        }
        const unsyncedChanges = plugin.unsyncedChanges;
        if (unsyncedChanges.empty) {
          continue;
        }

        const viewDoc = view.state.doc;
        if (viewDoc.eq(file.doc)) {
          plugin.clear();
          file.syncedDocs.set(view, viewDoc);
          continue;
        }

        const syncedDoc = file.syncedDocs.get(view);
        const changes = syncedDoc?.eq(file.doc)
          ? unsyncedChanges
          : ChangeSet.of(
              { from: 0, insert: viewDoc, to: file.doc.length },
              file.doc.length
            );
        result.push({ changes, file, prevDoc: file.doc });
        file.doc = viewDoc;
        file.version = this.#nextFileVersion(file.uri);
        plugin.clear();
        file.syncedDocs.set(view, viewDoc);

        for (const duplicateView of file.views) {
          if (duplicateView === view || !duplicateView.state.doc.eq(viewDoc)) {
            continue;
          }
          const duplicatePlugin = LSPPlugin.get(duplicateView);
          if (duplicatePlugin && !duplicatePlugin.unsyncedChanges.empty) {
            duplicatePlugin.clear();
            file.syncedDocs.set(duplicateView, viewDoc);
          }
        }
        break;
      }
    }
    return result;
  }

  openFile(uri: string, languageId: string, view: EditorView): void {
    const existing = this.getFile(uri) as PierWorkspaceFile | null;
    if (existing) {
      if (!existing.views.has(view)) {
        existing.views.add(view);
        existing.syncedDocs.set(view, view.state.doc);
      }
      return;
    }

    const views = new Set([view]);
    const syncedDocs = new WeakMap<EditorView, Text>();
    syncedDocs.set(view, view.state.doc);
    const file: PierWorkspaceFile = {
      doc: view.state.doc,
      getView: (main?: EditorView) => {
        if (main && views.has(main)) {
          return main;
        }
        return views.values().next().value ?? null;
      },
      languageId,
      syncedDocs,
      uri,
      version: this.#nextFileVersion(uri),
      views,
    };
    this.files.push(file);
    this.client.didOpen(file);
  }

  closeFile(uri: string, view: EditorView): void {
    const file = this.getFile(uri) as PierWorkspaceFile | null;
    if (!file?.views.delete(view)) {
      return;
    }
    file.syncedDocs.delete(view);
    if (file.views.size > 0) {
      return;
    }
    this.files = this.files.filter((entry) => entry !== file);
    this.client.didClose(uri);
  }

  closeOpenFiles(): void {
    const files = this.files;
    this.files = [];
    for (const file of files) {
      this.client.didClose(file.uri);
    }
  }

  override async displayFile(uri: string): Promise<EditorView | null> {
    const existing = this.getFile(uri)?.getView() ?? null;
    if (existing) {
      existing.focus();
      return existing;
    }
    const absolute = absolutePathFromFileUri(uri);
    if (!absolute) {
      return null;
    }
    return this.#onDisplayFile(absolute);
  }
}
