import type { RendererPluginContext } from "@plugins/api/renderer.ts";
import type { FilesDocument } from "../document/types.ts";
import {
  registerFileChangeEditor,
  requestFileChange,
} from "../git-changes/requests.ts";
import {
  type FileChangesResource,
  getFileChangesResource,
} from "../git-changes/resource.ts";
import type { FileEditorViewSession } from "./view-session.ts";

/** Source gutter/minimap consume the same live document resource as Markdown. */
export class FilesEditorGitGutterController {
  readonly #entries = new Map<
    string,
    {
      root: string;
      resource: FileChangesResource;
      session: FileEditorViewSession;
      close: () => void;
    }
  >();
  readonly #context: RendererPluginContext;
  constructor(context: RendererPluginContext) {
    this.#context = context;
  }
  attach(
    editorSessionId: string,
    document: FilesDocument,
    session: FileEditorViewSession
  ): void {
    this.detach(editorSessionId);
    if (document.source.kind !== "disk") {
      session.clearGitGutterMarkers();
      return;
    }
    const resource = getFileChangesResource(this.#context, document.id);
    const view = session.getEditorView();
    const unregister = view
      ? registerFileChangeEditor(editorSessionId, view)
      : () => undefined;
    let active = true;
    const update = () =>
      queueMicrotask(() => {
        if (!active) return;
        const snapshot = resource.getSnapshot();
        if (snapshot.status === "ready") session.setGitGutterModel(snapshot);
        else if (snapshot.status !== "updating" || snapshot.ranges.length === 0)
          session.clearGitGutterMarkers();
      });
    const unsubscribe = resource.subscribe(update);
    const start = () => resource.setComposing(true, editorSessionId);
    const end = () => resource.setComposing(false, editorSessionId);
    view?.contentDOM.addEventListener("compositionstart", start);
    view?.contentDOM.addEventListener("compositionend", end);
    session.setGitGutterNavigate((line) =>
      requestFileChange(editorSessionId, { kind: "line", line })
    );
    this.#entries.set(editorSessionId, {
      root: document.source.root,
      resource,
      session,
      close: () => {
        active = false;
        unsubscribe();
        unregister();
        view?.contentDOM.removeEventListener("compositionstart", start);
        view?.contentDOM.removeEventListener("compositionend", end);
        resource.setComposing(false, editorSessionId);
        session.setGitGutterNavigate(null);
      },
    });
    update();
  }
  detach(editorSessionId: string): void {
    this.#entries.get(editorSessionId)?.close();
    this.#entries.delete(editorSessionId);
  }
  clearSession(editorSessionId: string): void {
    this.#entries.get(editorSessionId)?.session.clearGitGutterMarkers();
  }
  refreshByDocument(documentId: string): void {
    for (const entry of this.#entries.values()) {
      const snapshot = entry.resource.getSnapshot();
      if (
        entry.resource.documentId === documentId &&
        snapshot.status === "ready"
      )
        entry.session.setGitGutterModel(snapshot);
    }
  }
  refreshByRoot(root: string): void {
    const resources = new Set(
      [...this.#entries.values()]
        .filter((entry) => entry.root === root)
        .map((entry) => entry.resource)
    );
    for (const resource of resources) resource.refresh();
  }
  dispose(): void {
    for (const id of this.#entries.keys()) this.detach(id);
  }
}
