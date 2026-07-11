import type { RendererPluginContext } from "@plugins/api/renderer.ts";
import type { FilePathImpact } from "@shared/contracts/file.ts";
import type { FileEditorViewSession } from "./file-editor-view-session.ts";
import { findAffectedOpenDocuments } from "./files-dirty-path-guard.ts";
import { listOpenDiskDocuments } from "./files-document-store.ts";
import type { FilesDocument } from "./files-document-types.ts";

export interface FilePathMutationGuard {
  currentDocuments(): FilesDocument[];
  documents: readonly FilesDocument[];
  release(): void;
}

interface ActivePathMutation {
  impacts: readonly FilePathImpact[];
  lockedDocumentIds: Set<string>;
}

export class FilePathMutationGuardCoordinator {
  readonly #active = new Map<symbol, ActivePathMutation>();
  readonly #context: RendererPluginContext;
  readonly #isEditingSuspended: () => boolean;
  readonly #sessions: () => Iterable<FileEditorViewSession>;
  readonly #suspensionCounts = new Map<string, number>();

  constructor(input: {
    context: RendererPluginContext;
    isEditingSuspended: () => boolean;
    sessions: () => Iterable<FileEditorViewSession>;
  }) {
    this.#context = input.context;
    this.#isEditingSuspended = input.isEditingSuspended;
    this.#sessions = input.sessions;
  }

  async begin(
    root: string,
    paths: readonly string[]
  ): Promise<FilePathMutationGuard> {
    return this.#beginWithImpacts(await this.#inspectImpacts(root, paths));
  }

  async beginMove(
    root: string,
    oldPath: string,
    newPath: string
  ): Promise<FilePathMutationGuard> {
    const sourceImpact = await this.#context.files.inspectPathImpact({
      path: oldPath,
      root,
    });
    return this.#beginWithImpacts([
      sourceImpact,
      {
        canonicalBackingPrefix: newPath,
        kind: "regular",
        locatorPrefix: newPath,
        root,
      },
    ]);
  }

  #beginWithImpacts(impacts: readonly FilePathImpact[]): FilePathMutationGuard {
    const token = Symbol("files-path-mutation");
    const state: ActivePathMutation = {
      impacts,
      lockedDocumentIds: new Set(),
    };
    this.#active.set(token, state);
    const currentDocuments = () => {
      const documents = this.#documentsForImpacts(impacts);
      for (const document of documents) {
        this.#lock(state, document.id);
      }
      return documents;
    };
    const documents = currentDocuments();
    let released = false;
    return {
      currentDocuments,
      documents,
      release: () => {
        if (released) {
          return;
        }
        released = true;
        this.#active.delete(token);
        this.#unlock(state.lockedDocumentIds);
      },
    };
  }

  async documentsFor(
    root: string,
    paths: readonly string[]
  ): Promise<FilesDocument[]> {
    return this.#documentsForImpacts(await this.#inspectImpacts(root, paths));
  }

  syncDocument(document: FilesDocument): void {
    if (document.source.kind !== "disk") {
      return;
    }
    const guardDocument = {
      ...document,
      kind: "disk" as const,
      path: document.source.path,
      root: document.source.root,
    };
    for (const state of this.#active.values()) {
      if (
        findAffectedOpenDocuments([guardDocument], state.impacts).length > 0
      ) {
        this.#lock(state, document.id);
      }
    }
  }

  syncSessions(): void {
    for (const session of this.#sessions()) {
      session.setHostReadOnly(
        this.#isEditingSuspended() ||
          this.#suspensionCounts.has(session.documentId)
      );
    }
  }

  dispose(): void {
    this.#active.clear();
    this.#suspensionCounts.clear();
  }

  async #inspectImpacts(
    root: string,
    paths: readonly string[]
  ): Promise<readonly FilePathImpact[]> {
    return await Promise.all(
      paths.map((path) => this.#context.files.inspectPathImpact({ path, root }))
    );
  }

  #documentsForImpacts(impacts: readonly FilePathImpact[]): FilesDocument[] {
    return findAffectedOpenDocuments(
      listOpenDiskDocuments().map((document) => ({
        ...document,
        kind: "disk" as const,
        path: document.source.kind === "disk" ? document.source.path : "",
        root: document.source.kind === "disk" ? document.source.root : "",
      })),
      impacts
    );
  }

  #lock(state: ActivePathMutation, documentId: string): void {
    if (state.lockedDocumentIds.has(documentId)) {
      return;
    }
    state.lockedDocumentIds.add(documentId);
    this.#suspensionCounts.set(
      documentId,
      (this.#suspensionCounts.get(documentId) ?? 0) + 1
    );
    this.syncSessions();
  }

  #unlock(documentIds: Iterable<string>): void {
    for (const documentId of documentIds) {
      const next = (this.#suspensionCounts.get(documentId) ?? 1) - 1;
      if (next > 0) {
        this.#suspensionCounts.set(documentId, next);
      } else {
        this.#suspensionCounts.delete(documentId);
      }
    }
    this.syncSessions();
  }
}
