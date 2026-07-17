import type { RendererPluginContext } from "@plugins/api/renderer.ts";
import type { FileEditorViewSession } from "./file-editor-view-session.ts";
import type { FilesDocument } from "./files-document-types.ts";
import { markersFromDiffPatch } from "./files-editor-git-markers.ts";

interface GitGutterEntry {
  documentId: string;
  editorSessionId: string;
  path: string;
  root: string;
  session: FileEditorViewSession;
}

interface WatchSlot {
  refreshTimer: ReturnType<typeof setTimeout> | undefined;
  rootGeneration: number;
  sessionIds: Set<string>;
  unsubscribe: () => void;
}

const REFRESH_DEBOUNCE_MS = 200;

/**
 * 编辑器 git gutter 编排：attach 时拉 `getDiffPatch(root, { from: "HEAD" })`，
 * 一次取整树 patch 再按 path 分发给该 root 下所有会话（合并 IPC，避免每个文件各拉一次）。
 * 按 root 订阅 `git.watch`（引用计数），watch 命中防抖刷新，root-scoped generation 丢弃
 * 过期响应。失败静默清空（不 toast）。仅 disk + source 模式生效（mode 由 controller/panel 控制）。
 */
export class FilesEditorGitGutterController {
  readonly #context: RendererPluginContext;
  readonly #entries = new Map<string, GitGutterEntry>();
  readonly #watches = new Map<string, WatchSlot>();

  constructor(context: RendererPluginContext) {
    this.#context = context;
  }

  attach(
    editorSessionId: string,
    document: FilesDocument,
    session: FileEditorViewSession
  ): void {
    if (document.source.kind !== "disk") {
      session.clearGitGutterMarkers();
      return;
    }
    const root = document.source.root;
    const path = document.source.path;
    const entry: GitGutterEntry = {
      documentId: document.id,
      editorSessionId,
      path,
      root,
      session,
    };
    this.#entries.set(editorSessionId, entry);
    this.#ensureWatch(root, editorSessionId);
    this.#refreshRoot(root).catch(() => undefined);
  }

  detach(editorSessionId: string): void {
    const entry = this.#entries.get(editorSessionId);
    if (!entry) {
      return;
    }
    this.#entries.delete(editorSessionId);
    const slot = this.#watches.get(entry.root);
    if (slot) {
      slot.sessionIds.delete(editorSessionId);
      if (slot.sessionIds.size === 0) {
        clearTimeout(slot.refreshTimer);
        slot.unsubscribe();
        this.#watches.delete(entry.root);
      }
    }
  }

  clearSession(editorSessionId: string): void {
    this.#entries.get(editorSessionId)?.session.clearGitGutterMarkers();
  }

  refreshByDocument(documentId: string): void {
    // 保存后按文档刷新：合并到 root 级一次拉取，保持与 watch 同一 IPC 路径。
    for (const current of this.#entries.values()) {
      if (current.documentId === documentId) {
        this.#refreshRoot(current.root).catch(() => undefined);
        return;
      }
    }
  }

  refreshByRoot(root: string): void {
    const slot = this.#watches.get(root);
    if (!slot || slot.sessionIds.size === 0) {
      return;
    }
    clearTimeout(slot.refreshTimer);
    slot.refreshTimer = setTimeout(() => {
      slot.refreshTimer = undefined;
      this.#refreshRoot(root).catch(() => undefined);
    }, REFRESH_DEBOUNCE_MS);
  }

  dispose(): void {
    for (const slot of this.#watches.values()) {
      clearTimeout(slot.refreshTimer);
      slot.unsubscribe();
    }
    this.#watches.clear();
    this.#entries.clear();
  }

  #ensureWatch(root: string, editorSessionId: string): void {
    let slot = this.#watches.get(root);
    if (!slot) {
      const gitApi = (this.#context as Partial<RendererPluginContext>).git;
      if (!gitApi?.watch) {
        return;
      }
      const unsubscribe = gitApi.watch(
        root,
        () => this.refreshByRoot(root),
        () => undefined
      );
      slot = {
        refreshTimer: undefined,
        rootGeneration: 0,
        sessionIds: new Set(),
        unsubscribe,
      };
      this.#watches.set(root, slot);
    }
    slot.sessionIds.add(editorSessionId);
  }

  async #refreshRoot(root: string): Promise<void> {
    const slot = this.#watches.get(root);
    if (!slot) {
      return;
    }
    const gitApi = (this.#context as Partial<RendererPluginContext>).git;
    if (!gitApi?.getDiffPatch) {
      for (const entry of this.#entriesForRoot(root)) {
        entry.session.clearGitGutterMarkers();
      }
      return;
    }
    slot.rootGeneration += 1;
    const generation = slot.rootGeneration;
    try {
      const patch = await gitApi.getDiffPatch(root, { from: "HEAD" });
      if (slot.rootGeneration !== generation) {
        return;
      }
      const byPath = new Map(patch.files.map((f) => [f.path, f]));
      for (const entry of this.#entriesForRoot(root)) {
        const filePatch = byPath.get(entry.path) ?? null;
        entry.session.setGitGutterMarkers(markersFromDiffPatch(filePatch));
      }
    } catch {
      if (slot.rootGeneration === generation) {
        for (const entry of this.#entriesForRoot(root)) {
          entry.session.clearGitGutterMarkers();
        }
      }
    }
  }

  #entriesForRoot(root: string): GitGutterEntry[] {
    const result: GitGutterEntry[] = [];
    for (const entry of this.#entries.values()) {
      if (entry.root === root) {
        result.push(entry);
      }
    }
    return result;
  }
}
