import type { RendererPluginContext } from "@plugins/api/renderer.ts";
import type { FileWatchEvent } from "@shared/contracts/file-watch.ts";

type FilesApi = RendererPluginContext["files"];

interface RootWatchEntry {
  dispose: () => void;
  listeners: Set<(event: FileWatchEvent) => void>;
}

const TRAILING_SLASHES_PATTERN = /\/+$/;

function normalizeRoot(root: string): string {
  return root.replace(TRAILING_SLASHES_PATTERN, "");
}

/** 目录树和编辑器按根目录复用同一个底层文件监听。 */
export class FilesWatchHub {
  readonly #files: Pick<FilesApi, "watch">;
  readonly #roots = new Map<string, RootWatchEntry>();
  #disposed = false;

  constructor(files: Pick<FilesApi, "watch">) {
    this.#files = files;
  }

  subscribe(
    root: string,
    listener: (event: FileWatchEvent) => void
  ): () => void {
    if (this.#disposed) {
      return () => undefined;
    }

    const key = normalizeRoot(root);
    let entry = this.#roots.get(key);
    if (!entry) {
      const listeners = new Set<(event: FileWatchEvent) => void>();
      let dispose: () => void = () => undefined;
      try {
        dispose = this.#files.watch(root, (event) => {
          for (const currentListener of [...listeners]) {
            currentListener(event);
          }
        });
      } catch (error) {
        console.error("[files] file watch unavailable:", error);
      }
      entry = { dispose, listeners };
      this.#roots.set(key, entry);
    }

    entry.listeners.add(listener);
    let active = true;
    return () => {
      if (!active) {
        return;
      }
      active = false;
      const current = this.#roots.get(key);
      if (!current) {
        return;
      }
      current.listeners.delete(listener);
      if (current.listeners.size === 0) {
        current.dispose();
        this.#roots.delete(key);
      }
    };
  }

  dispose(): void {
    if (this.#disposed) {
      return;
    }
    this.#disposed = true;
    for (const entry of this.#roots.values()) {
      entry.dispose();
      entry.listeners.clear();
    }
    this.#roots.clear();
  }
}
