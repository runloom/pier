/**
 * CodeMirror adapter for the Files plugin LSP integration.
 * Main hosts language servers; renderer sessions are owned by the root manager.
 */
import { Compartment, type Extension } from "@codemirror/state";
import { type EditorView, ViewPlugin } from "@codemirror/view";
import type { PanelContext } from "@shared/contracts/panel.ts";
import { fileUriFromAbsolutePath } from "@shared/lsp-uri.ts";
import {
  clearFilesLanguageServiceStatusOwner,
  type FilesLanguageServiceStatus,
  publishFilesLanguageServiceStatus,
} from "../panel/language-service-status.ts";
import { DEFAULT_FILES_LSP_HOVER_LABELS } from "../panel/markdown-labels.ts";
import { filesLspDocumentationLinksExtension } from "./documentation-links.ts";
import { type FilesLspHoverInput, filesLspHoverExtension } from "./hover.ts";
import {
  openFilesLspAbsolutePath,
  registerFilesLspEditorView,
} from "./navigation.ts";
import {
  FilesLspAttachmentLifecycle,
  normalizeFilesLspRoot,
  resetLspClientCacheForTests as resetRootSessionCacheForTests,
  subscribeFilesLspPolicy,
} from "./root-session.ts";

/**
 * CodeMirror extensions that connect this editor to the selected LSP session.
 * No-op when main reports no provider or the preload bridge is missing.
 */
export function filesLspEditorExtensions(input: {
  absolutePath: string;
  documentId: string;
  getOpenExternal: () => (url: string) => void;
  getLabels?: FilesLspHoverInput["getLabels"];
  languageId?: string;
  notifyError?: FilesLspHoverInput["notifyError"];
  onDisplayFile?: (absolutePath: string) => Promise<EditorView | null>;
  ownerId: string;
  readDocument?: FilesLspHoverInput["readDocument"];
  panelContext?: PanelContext;
  rootPath: string;
}): Extension {
  const absolutePath = input.absolutePath;
  const uri = fileUriFromAbsolutePath(absolutePath);
  const rootPath = input.rootPath;
  const onDisplayFile =
    input.onDisplayFile ??
    ((path: string) => openFilesLspAbsolutePath(path, rootPath));
  const getLabels = input.getLabels ?? (() => DEFAULT_FILES_LSP_HOVER_LABELS);
  const readDocument =
    input.readDocument ??
    (() => Promise.reject(new Error("File document reader unavailable")));

  const manualLifecycleByView = new WeakMap<
    EditorView,
    {
      lifecycle: FilesLspAttachmentLifecycle;
      status: FilesLanguageServiceStatus | null;
    }
  >();
  const connectedCompartment = new Compartment();
  return [
    filesLspDocumentationLinksExtension(input.getOpenExternal),
    filesLspHoverExtension({
      documentId: input.documentId,
      getLabels,
      ...(input.notifyError ? { notifyError: input.notifyError } : {}),
      ownerId: input.ownerId,
      readDocument,
      prepareForManual: (view) => {
        const manual = manualLifecycleByView.get(view);
        if (!manual) {
          return "unavailable";
        }
        const state = manual.status?.state;
        if (
          state === "disabled" ||
          state === "unsupported" ||
          state === "error"
        ) {
          return "unavailable";
        }
        manual.lifecycle.resume();
        return state === "ready" ? "ready" : "pending";
      },
      rootPath,
    }),
    connectedCompartment.of([]),
    ViewPlugin.fromClass(
      class {
        readonly #lifecycle: FilesLspAttachmentLifecycle;
        readonly #unsubscribePolicy: () => void;
        #connected = false;
        #destroyed = false;
        #unregisterNavigation: (() => void) | null = null;

        readonly view: EditorView;

        constructor(view: EditorView) {
          this.view = view;
          // Register path immediately so Go to Definition (including CSS
          // package @import without a language server) can resolve this view.
          // Must not wait for LSP connect — CSS LS is often missing.
          this.#unregisterNavigation = registerFilesLspEditorView(
            absolutePath,
            this.view,
            rootPath
          );
          this.#lifecycle = new FilesLspAttachmentLifecycle({
            attachment: {
              absolutePath,
              connect: (client, languageId) => {
                this.#disconnectLsp();
                if (this.#destroyed) {
                  return;
                }
                this.view.dispatch({
                  effects: connectedCompartment.reconfigure(
                    client.plugin(uri, languageId)
                  ),
                });
                this.#connected = true;
              },
              disconnect: () => {
                this.#disconnectLsp();
              },
              documentId: input.documentId,
              ownerId: input.ownerId,
              ...(input.languageId
                ? { requestedLanguageId: input.languageId }
                : {}),
              publish: (status) => {
                const manual = manualLifecycleByView.get(this.view);
                if (manual) {
                  manual.status = status;
                }
                if (status) {
                  publishFilesLanguageServiceStatus(
                    input.ownerId,
                    input.documentId,
                    status
                  );
                } else {
                  clearFilesLanguageServiceStatusOwner(input.ownerId);
                }
              },
            },
            onDisplayFile,
            ...(input.panelContext ? { panelContext: input.panelContext } : {}),
            rootPath,
          });
          manualLifecycleByView.set(view, {
            lifecycle: this.#lifecycle,
            status: null,
          });
          this.#unsubscribePolicy = subscribeFilesLspPolicy((prefs) => {
            this.#lifecycle.setPolicy(prefs);
          });
          this.view.dom.addEventListener("focusin", this.#resumeOnFocus);
          this.#lifecycle.start();
        }

        readonly #resumeOnFocus = () => {
          this.#lifecycle.resume();
        };

        /** Detach language-server plugin only; keep path registration for navigation. */
        #disconnectLsp(): void {
          if (!this.#connected) {
            return;
          }
          this.#connected = false;
          if (!this.#destroyed) {
            this.view.dispatch({
              effects: connectedCompartment.reconfigure([]),
            });
          }
        }

        destroy(): void {
          this.#destroyed = true;
          manualLifecycleByView.delete(this.view);
          this.view.dom.removeEventListener("focusin", this.#resumeOnFocus);
          this.#unsubscribePolicy();
          this.#lifecycle.destroy();
          this.#disconnectLsp();
          this.#unregisterNavigation?.();
          this.#unregisterNavigation = null;
        }
      }
    ),
  ];
}

export function absoluteDiskPathForDocument(source: {
  kind: string;
  path?: string;
  root?: string;
}): { absolutePath: string; rootPath: string } | null {
  if (source.kind !== "disk" || !source.path || !source.root) {
    return null;
  }
  const rootPath = normalizeFilesLspRoot(source.root);
  const rel = source.path.replace(/\\/g, "/").replace(/^\/+/, "");
  let absolutePath: string;
  if (rootPath === "/") {
    absolutePath = `/${rel}`;
  } else if (rel.length === 0) {
    absolutePath = rootPath;
  } else {
    absolutePath = `${rootPath}/${rel}`;
  }
  return { absolutePath, rootPath };
}

/** Test seam: clear the root-client cache between tests. */
export function resetLspClientCacheForTests(): void {
  resetRootSessionCacheForTests();
}
