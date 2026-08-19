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
 * 可见编辑器的保活节奏：明显小于 main 侧 idleReleaseMs 下限（60s 起，
 * 默认 30 分钟），保证用户正在看的面板不被空闲回收。
 */
export const FILES_LSP_VISIBLE_TOUCH_INTERVAL_MS = 5 * 60_000;

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
        #visibilityObserver: IntersectionObserver | null = null;
        #keepaliveTimer: ReturnType<typeof setInterval> | null = null;

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
                if (status?.state === "paused" && this.#keepaliveTimer) {
                  this.#lifecycle.resume();
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
          this.#observeVisibility();
          this.#lifecycle.start();
        }

        readonly #resumeOnFocus = () => {
          this.#lifecycle.resume();
        };

        /**
         * 面板可见性驱动的生命周期：
         * - 隐藏 → 可见：立即 resume（空闲关停后的预热藏在切 tab 动作后面）
         *   并 touch 一次刷新 main 侧空闲时钟；
         * - 可见期间：周期性 touch 保活，正在阅读的编辑器不会被空闲回收；
         * - 隐藏（dockview 背景 tab）：停止保活，工作区自然进入空闲窗口。
         */
        #observeVisibility(): void {
          if (typeof IntersectionObserver !== "function") {
            return;
          }
          this.#visibilityObserver = new IntersectionObserver((entries) => {
            const visible = entries.some((entry) => entry.isIntersecting);
            if (visible) {
              this.#startKeepalive();
            } else {
              this.#stopKeepalive();
            }
          });
          this.#visibilityObserver.observe(this.view.dom);
        }

        #startKeepalive(): void {
          if (this.#destroyed || this.#keepaliveTimer) {
            return;
          }
          this.#lifecycle.resume();
          this.#lifecycle.touch();
          this.#keepaliveTimer = setInterval(() => {
            this.#lifecycle.resume();
            this.#lifecycle.touch();
          }, FILES_LSP_VISIBLE_TOUCH_INTERVAL_MS);
        }

        #stopKeepalive(): void {
          if (this.#keepaliveTimer) {
            clearInterval(this.#keepaliveTimer);
            this.#keepaliveTimer = null;
          }
        }

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
          this.#stopKeepalive();
          this.#visibilityObserver?.disconnect();
          this.#visibilityObserver = null;
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
