import type { RendererPluginContext } from "@plugins/api/renderer.ts";
import type { GitFileBaselineResult } from "@shared/contracts/git/file-baseline.ts";
import { getDocument, subscribeFilesDocumentStore } from "../document/store.ts";
import { comparisonSize, FILE_CHANGES_DEBOUNCE_MS } from "./limits.ts";
import { retryFileChangesRoot, watchFileChangesRoot } from "./root-watch.ts";
import { EMPTY_FILE_CHANGES, type FileChangesSnapshot } from "./types.ts";
import { FileChangesWorker } from "./worker-client.ts";

function unsupportedText(reason: string | null): boolean {
  return Boolean(reason && reason !== "not-writable" && reason !== "mixed-eol");
}

let nextVersion = 1;
const resources = new WeakMap<
  RendererPluginContext,
  Map<string, FileChangesResource>
>();
export const EMPTY_CHANGES_SNAPSHOT: FileChangesSnapshot = {
  ...EMPTY_FILE_CHANGES,
  status: "unavailable",
  version: 0,
  contents: "",
  baseline: "",
  headOid: null,
  dirty: false,
};

/** One resource for each live FilesDocument, regardless of its panel/view count. */
export class FileChangesResource {
  #snapshot: FileChangesSnapshot = {
    ...EMPTY_CHANGES_SNAPSHOT,
    status: "loading",
  };
  readonly #listeners = new Set<() => void>();
  #cleanup: (() => void) | null = null;
  #timer: ReturnType<typeof setTimeout> | undefined;
  #generation = 0;
  #baseline: Extract<GitFileBaselineResult, { status: "ready" }> | null = null;
  readonly #composing = new Set<string>();
  #sourceKey = "";
  #stopWatch: (() => void) | null = null;
  #watchFailed = false;
  readonly context: RendererPluginContext;
  readonly documentId: string;
  readonly #worker: Pick<FileChangesWorker, "compare" | "cancel">;
  constructor(
    context: RendererPluginContext,
    documentId: string,
    worker: Pick<
      FileChangesWorker,
      "compare" | "cancel"
    > = new FileChangesWorker()
  ) {
    this.context = context;
    this.documentId = documentId;
    this.#worker = worker;
  }
  getSnapshot = (): FileChangesSnapshot => this.#snapshot;
  subscribe = (listener: () => void): (() => void) => {
    this.#listeners.add(listener);
    if (!this.#cleanup) this.#start();
    return () => {
      this.#listeners.delete(listener);
      queueMicrotask(() => {
        if (!this.#listeners.size) this.dispose();
      });
    };
  };
  #emit(next: FileChangesSnapshot): void {
    this.#snapshot = next;
    for (const listener of this.#listeners) listener();
  }
  #start(): void {
    this.#cleanup = subscribeFilesDocumentStore(() => this.#syncDocument());
    this.#syncDocument();
  }
  #syncDocument(): void {
    const document = getDocument(this.documentId);
    if (
      document?.source.kind !== "disk" ||
      unsupportedText(document.readOnlyReason) ||
      document.loadState !== "loaded"
    ) {
      clearTimeout(this.#timer);
      this.#worker.cancel();
      this.#generation++;
      this.#baseline = null;
      this.#sourceKey = "";
      this.#stopWatch?.();
      this.#stopWatch = null;
      const status =
        document?.loadState === "loading" || document?.loadState === "idle"
          ? "loading"
          : "unavailable";
      if (this.#snapshot.status !== status || this.#snapshot.ranges.length)
        this.#emit({
          ...EMPTY_CHANGES_SNAPSHOT,
          status,
          version: nextVersion++,
        });
      return;
    }
    const sourceKey = `${document.source.root}\0${document.source.path}`;
    const changed = document.currentContents !== this.#snapshot.contents;
    if (sourceKey !== this.#sourceKey) {
      this.#watchFailed = false;
      this.#sourceKey = sourceKey;
      this.#baseline = null;
      this.#stopWatch?.();
      this.#stopWatch = watchFileChangesRoot(
        this.context,
        document.source.root,
        (error) => {
          this.#watchFailed = Boolean(error);
          if (error) {
            this.#generation++;
            clearTimeout(this.#timer);
            this.#worker.cancel();
            this.#baseline = null;
            this.#emit({
              ...this.#snapshot,
              ...EMPTY_FILE_CHANGES,
              status: "error",
              message: error.message,
              version: nextVersion++,
            });
            return;
          }
          this.refresh();
        }
      );
      this.#emit({
        ...EMPTY_CHANGES_SNAPSHOT,
        contents: document.currentContents,
        dirty: document.dirty,
        status: "loading",
        version: nextVersion++,
      });
      this.refresh();
      return;
    }
    if (changed) {
      this.#worker.cancel();
      this.#emit({
        ...this.#snapshot,
        contents: document.currentContents,
        dirty: document.dirty,
        status: this.#baseline ? "updating" : this.#snapshot.status,
        version: nextVersion++,
      });
      this.#schedule();
    } else if (document.dirty !== this.#snapshot.dirty) {
      this.#emit({ ...this.#snapshot, dirty: document.dirty });
    }
  }
  async refresh(): Promise<void> {
    const document = getDocument(this.documentId);
    if (
      document?.source.kind !== "disk" ||
      unsupportedText(document.readOnlyReason) ||
      document.loadState !== "loaded" ||
      this.#watchFailed
    )
      return;
    const generation = ++this.#generation;
    try {
      const result = await this.context.git.getFileBaseline({
        root: document.source.root,
        path: document.source.path,
      });
      if (generation !== this.#generation || !this.#cleanup) return;
      if (result.status !== "ready") {
        this.#worker.cancel();
        this.#baseline = null;
        this.#emit({
          ...this.#snapshot,
          ...EMPTY_FILE_CHANGES,
          status: result.status,
          message: result.status === "error" ? result.message : result.reason,
          version: nextVersion++,
        });
        return;
      }
      const previous = this.#baseline;
      this.#baseline = result;
      if (
        !previous ||
        previous.headOid !== result.headOid ||
        previous.basePath !== result.basePath ||
        previous.contents !== result.contents
      ) {
        this.#worker.cancel();
        this.#emit({
          ...this.#snapshot,
          ...EMPTY_FILE_CHANGES,
          baseline: result.contents,
          headOid: result.headOid,
          gitRoot: result.gitRoot,
          path: result.path,
          status: "updating",
          version: nextVersion++,
        });
        this.#schedule();
      }
    } catch (error) {
      if (generation !== this.#generation || !this.#cleanup) return;
      this.#worker.cancel();
      this.#baseline = null;
      this.#emit({
        ...this.#snapshot,
        ...EMPTY_FILE_CHANGES,
        status: "error",
        message: error instanceof Error ? error.message : String(error),
        version: nextVersion++,
      });
    }
  }
  #schedule(): void {
    clearTimeout(this.#timer);
    if (!this.#baseline || this.#composing.size > 0) return;
    this.#timer = setTimeout(() => {
      this.calculate(false);
    }, FILE_CHANGES_DEBOUNCE_MS);
  }
  setComposing(value: boolean, owner = "default"): void {
    if (this.#composing.has(owner) === value) return;
    if (value) this.#composing.add(owner);
    else this.#composing.delete(owner);
    if (value) {
      clearTimeout(this.#timer);
      this.#worker.cancel();
    } else this.#schedule();
  }
  async calculate(onDemand = true): Promise<void> {
    clearTimeout(this.#timer);
    const source = getDocument(this.documentId)?.source;
    if (this.#watchFailed && source?.kind === "disk") {
      this.#watchFailed = false;
      retryFileChangesRoot(this.context, source.root);
    }
    if (!this.#baseline) {
      await this.refresh();
      return;
    }
    const current = this.#snapshot;
    const sizes = [
      comparisonSize(current.contents),
      comparisonSize(current.baseline),
    ];
    if (
      sizes.includes("unavailable") ||
      (!onDemand && sizes.includes("on-demand"))
    ) {
      this.#emit({
        ...current,
        ...EMPTY_FILE_CHANGES,
        status: sizes.includes("unavailable") ? "unavailable" : "on-demand",
        message: "too-large",
      });
      return;
    }
    this.#emit({ ...current, status: "updating" });
    try {
      const result = await this.#worker.compare(
        {
          path: this.#baseline.path,
          before: current.baseline,
          after: current.contents,
          version: current.version,
        },
        onDemand ? 5000 : 2000
      );
      if (result && current.version === this.#snapshot.version && this.#cleanup)
        this.#emit({ ...this.#snapshot, ...result, status: "ready" });
    } catch (error) {
      if (current.version !== this.#snapshot.version || !this.#cleanup) return;
      this.#emit({
        ...this.#snapshot,
        ...EMPTY_FILE_CHANGES,
        status: "error",
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }
  dispose(): void {
    clearTimeout(this.#timer);
    this.#worker.cancel();
    this.#generation++;
    this.#cleanup?.();
    this.#cleanup = null;
    this.#stopWatch?.();
    this.#stopWatch = null;
    this.#sourceKey = "";
    this.#watchFailed = false;
    this.#baseline = null;
    this.#composing.clear();
    this.#snapshot = EMPTY_CHANGES_SNAPSHOT;
    if (resources.get(this.context)?.get(this.documentId) === this)
      resources.get(this.context)?.delete(this.documentId);
  }
}
export function getFileChangesResource(
  context: RendererPluginContext,
  documentId: string
): FileChangesResource {
  let map = resources.get(context);
  if (!map) {
    map = new Map();
    resources.set(context, map);
  }
  let resource = map.get(documentId);
  if (!resource) {
    resource = new FileChangesResource(context, documentId);
    map.set(documentId, resource);
  }
  return resource;
}
