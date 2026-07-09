import type { FileWatchEvent } from "@shared/contracts/file-watch.ts";
import { getDocument } from "./files-document-store.ts";
import type { FilesDocumentPanelSource } from "./files-document-types.ts";
import type { FilesWatchHub } from "./files-watch-hub.ts";

interface PanelSession {
  documentId: string;
  source: FilesDocumentPanelSource;
  token: symbol;
}

interface RootSubscription {
  count: number;
  dispose: () => void;
}

const TRAILING_SLASHES_PATTERN = /\/+$/;

function normalizeRoot(root: string): string {
  return root.replace(TRAILING_SLASHES_PATTERN, "");
}

export class FileDocumentPanelRegistry {
  readonly #onFileWatch: (event: FileWatchEvent) => void;
  readonly #panels = new Map<string, PanelSession>();
  readonly #roots = new Map<string, RootSubscription>();
  readonly #watchHub: FilesWatchHub;

  constructor(input: {
    onFileWatch: (event: FileWatchEvent) => void;
    watchHub: FilesWatchHub;
  }) {
    this.#onFileWatch = input.onFileWatch;
    this.#watchHub = input.watchHub;
  }

  acquire(input: {
    documentId: string;
    panelId: string;
    source: FilesDocumentPanelSource;
  }): () => void {
    const existing = this.#panels.get(input.panelId);
    if (existing) {
      this.#releaseRoot(existing.source);
    }
    const token = Symbol(input.panelId);
    this.#panels.set(input.panelId, { ...input, token });
    this.#acquireRoot(input.source);
    return () => {
      const current = this.#panels.get(input.panelId);
      if (current?.token !== token) {
        return;
      }
      this.#panels.delete(input.panelId);
      this.#releaseRoot(input.source);
    };
  }

  documentId(panelId: string): string | null {
    return this.#panels.get(panelId)?.documentId ?? null;
  }

  documentIds(): Set<string> {
    const documentIds = new Set<string>();
    for (const panel of this.#panels.values()) {
      const document = getDocument(panel.documentId);
      if (document) {
        documentIds.add(document.id);
      }
    }
    return documentIds;
  }

  documentIdsForRoot(root: string): Set<string> {
    const documentIds = new Set<string>();
    for (const panel of this.#panels.values()) {
      const document = getDocument(panel.documentId);
      if (
        document?.source.kind === "disk" &&
        normalizeRoot(document.source.root) === normalizeRoot(root)
      ) {
        documentIds.add(document.id);
      }
    }
    return documentIds;
  }

  panelIdForDocument(documentId: string): string | null {
    const canonicalId = getDocument(documentId)?.id;
    for (const [panelId, panel] of this.#panels) {
      if (getDocument(panel.documentId)?.id === canonicalId) {
        return panelId;
      }
    }
    return null;
  }

  dispose(): void {
    for (const subscription of this.#roots.values()) {
      subscription.dispose();
    }
    this.#roots.clear();
    this.#panels.clear();
  }

  #acquireRoot(source: FilesDocumentPanelSource): void {
    if (source.kind !== "disk") {
      return;
    }
    const existing = this.#roots.get(source.root);
    if (existing) {
      existing.count += 1;
      return;
    }
    this.#roots.set(source.root, {
      count: 1,
      dispose: this.#watchHub.subscribe(source.root, this.#onFileWatch),
    });
  }

  #releaseRoot(source: FilesDocumentPanelSource): void {
    if (source.kind !== "disk") {
      return;
    }
    const entry = this.#roots.get(source.root);
    if (!entry) {
      return;
    }
    entry.count -= 1;
    if (entry.count <= 0) {
      entry.dispose();
      this.#roots.delete(source.root);
    }
  }
}
