import type { RendererPluginContext } from "@plugins/api/renderer.ts";
import type { FileDocumentLoader } from "./loader.ts";
import { getDocument } from "./store.ts";

/**
 * Open-document sync backup when fs.watch drops events.
 *
 * - window focus / tab visible → immediate pass
 * - optional low-frequency pass uses **stat mtime/size only** (never content digest)
 *
 * Full content reload still goes through FileDocumentLoader.
 */
export const OPEN_DOCUMENT_RECONCILE_INTERVAL_MS = 15_000;

export class OpenDocumentReconciler {
  readonly #context: RendererPluginContext;
  readonly #getDocumentIds: () => ReadonlySet<string>;
  readonly #loader: Pick<FileDocumentLoader, "start">;
  #disposed = false;
  #intervalId: ReturnType<typeof setInterval> | null = null;
  #inFlight: Promise<void> | null = null;
  #pending = false;
  #removeFocus: (() => void) | null = null;
  #removeVisibility: (() => void) | null = null;

  constructor(input: {
    context: RendererPluginContext;
    getDocumentIds: () => ReadonlySet<string>;
    loader: Pick<FileDocumentLoader, "start">;
  }) {
    this.#context = input.context;
    this.#getDocumentIds = input.getDocumentIds;
    this.#loader = input.loader;
  }

  start(): void {
    if (this.#disposed || this.#intervalId !== null) {
      return;
    }
    const onFocus = () => {
      this.reconcileSoon();
    };
    const onVisibility = () => {
      if (document.visibilityState === "visible") {
        this.reconcileSoon();
      }
    };
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisibility);
    this.#removeFocus = () => window.removeEventListener("focus", onFocus);
    this.#removeVisibility = () =>
      document.removeEventListener("visibilitychange", onVisibility);
    this.#intervalId = setInterval(() => {
      if (this.#getDocumentIds().size === 0) {
        return;
      }
      this.reconcileSoon();
    }, OPEN_DOCUMENT_RECONCILE_INTERVAL_MS);
  }

  stop(): void {
    this.#removeFocus?.();
    this.#removeFocus = null;
    this.#removeVisibility?.();
    this.#removeVisibility = null;
    if (this.#intervalId !== null) {
      clearInterval(this.#intervalId);
      this.#intervalId = null;
    }
  }

  dispose(): void {
    this.#disposed = true;
    this.#pending = false;
    this.stop();
  }

  /** Coalesced fire-and-forget; a request during an in-flight pass queues one more. */
  reconcileSoon(): void {
    if (this.#disposed) {
      return;
    }
    if (this.#inFlight) {
      this.#pending = true;
      return;
    }
    this.#inFlight = this.#reconcileAll()
      .catch(() => undefined)
      .finally(() => {
        this.#inFlight = null;
        if (this.#pending && !this.#disposed) {
          this.#pending = false;
          this.reconcileSoon();
        }
      });
  }

  async #reconcileAll(): Promise<void> {
    const ids = [...this.#getDocumentIds()];
    if (ids.length === 0) {
      return;
    }
    await Promise.all(ids.map((documentId) => this.#reconcileOne(documentId)));
  }

  async #reconcileOne(documentId: string): Promise<void> {
    if (this.#disposed) {
      return;
    }
    const document = getDocument(documentId);
    if (document?.source.kind !== "disk" || document.deletedOnDisk) {
      return;
    }
    let stat: Awaited<ReturnType<RendererPluginContext["files"]["stat"]>>;
    try {
      stat = await this.#context.files.stat({
        path: document.source.path,
        root: document.source.root,
      });
    } catch {
      return;
    }
    if (this.#disposed) {
      return;
    }
    const latest = getDocument(documentId);
    if (
      latest?.source.kind !== "disk" ||
      latest.source.path !== document.source.path ||
      latest.source.root !== document.source.root
    ) {
      return;
    }

    if (!stat.exists) {
      if (latest.hasBackingStore || latest.revision !== null) {
        this.#loader.start(latest.id, true);
      }
      return;
    }

    // Lightweight fingerprint only. Missing baseMtimeMs/size (not yet loaded /
    // draft paths) must not drive periodic full reloads — wait until load/save
    // establishes a fingerprint, or a real mtime/size change is observable.
    const mtimeChanged =
      latest.baseMtimeMs !== null &&
      stat.mtimeMs !== null &&
      Math.abs(stat.mtimeMs - latest.baseMtimeMs) > 0.5;
    const sizeChanged =
      latest.size !== null && stat.size !== null && stat.size !== latest.size;

    if (mtimeChanged || sizeChanged) {
      this.#loader.start(latest.id, true);
    }
  }
}
